/**
 * POST /api/diagrams — store a diagram and hand back the ways to reach it.
 *
 * The document is addressed by the hash of its own bytes, which settles three
 * things at once. Storing the same diagram twice writes nothing the second
 * time. A hash cannot be squatted, because holding it means holding the
 * document. And an edit is a new address rather than a mutation, so a link
 * someone already shared keeps showing what it showed.
 *
 * A display id is the other half: a name a person chose, pointing at a hash.
 * Names are claim-once and re-pointing one needs the token handed out when it
 * was claimed, because with no accounts anywhere in this project that token is
 * the only thing distinguishing an author from a passer-by.
 *
 * Request:  { document, displayId?, editToken? }
 * Response: { hash, shortHash, displayId, editToken?, url }
 */

import { normalizeDoc, serializeDoc } from '../../src/core/schema.js';
import { createBlobStore, paths } from '../_lib/blob.js';
import { send, fail, readJson, callerKey, methodAllowed, writeTokenAccepted } from '../_lib/http.js';
import {
  MAX_DOCUMENT_BYTES,
  RATE_LIMITS,
  createRateLimiter,
  normaliseDisplayId,
  randomDisplayId,
  hashDocument,
  newEditToken,
  hashToken,
  tokenMatches,
  expiryOf,
  retentionDays,
} from '../_lib/policy.js';

const limiter = createRateLimiter(RATE_LIMITS.store);

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['POST'])) return;
  if (!writeTokenAccepted(req, process.env)) {
    return fail(res, 401, 'This deployment requires a token to store diagrams.');
  }

  const store = createBlobStore(process.env);
  if (!store.configured) {
    return fail(res, 503, 'Stored diagrams are not configured on this deployment.');
  }

  const allowed = limiter.check(callerKey(req));
  if (!allowed.ok) {
    return fail(res, 429, 'That is more diagrams than this deployment stores in one go. Try again shortly.', {
      retryAfter: allowed.retryAfter,
    });
  }

  const body = await readJson(req, MAX_DOCUMENT_BYTES);
  if (!body.ok) return fail(res, body.status, body.error);

  // Normalised through the editor's own loader before anything is stored, so
  // what comes back out is a document this editor can open — and so a store of
  // arbitrary JSON is not what this endpoint quietly becomes.
  const parsed = normalizeDoc(body.value?.document ?? body.value);
  if (parsed.rejection) {
    return fail(res, 422, `That is not a Massing diagram — ${parsed.rejection}`);
  }
  const text = serializeDoc(parsed.doc);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_DOCUMENT_BYTES) {
    return fail(res, 413, `The diagram is ${Math.round(bytes / 1024)} kB, past the ${Math.round(MAX_DOCUMENT_BYTES / 1024)} kB limit. Embedded pictures are usually what pushes it over.`);
  }

  const { full: hash, short: shortHash } = hashDocument(text);

  // --- the name ------------------------------------------------------------
  const wanted = body.value?.displayId;
  let displayId;
  if (wanted === undefined || wanted === null || String(wanted).trim() === '') {
    displayId = randomDisplayId();
  } else {
    const checked = normaliseDisplayId(wanted);
    if (checked.error) return fail(res, 400, checked.error);
    displayId = checked.id;
  }

  try {
    const existing = await store.getJson(paths.alias(displayId));
    let editToken = body.value?.editToken;
    if (existing?.value) {
      if (!tokenMatches(editToken, existing.value.tokenHash)) {
        return fail(res, 409, `"${displayId}" is already taken by someone else's diagram. Choose another name, or leave it blank for a generated one.`);
      }
    } else {
      // A fresh claim mints its own token; the caller never chooses one.
      editToken = newEditToken();
    }

    const at = new Date().toISOString();

    // The document first. A name pointing at nothing is the one broken state
    // worth ruling out, and writing the same content twice is free.
    await store.put(paths.document(hash), text, { contentType: 'application/json' });

    /*
     * A short link is claimed once and never repointed.
     *
     * Ten hex characters is forty bits, so two documents sharing a prefix is
     * remote -- but overwriting on collision would silently hand whoever holds
     * the older link a *different diagram*, which is the worst kind of failure
     * this could have. First claim keeps it; the newcomer simply has no short
     * link, and its name and full hash both still work.
     */
    const claimedShort = await store.getJson(paths.shortcut(shortHash));
    const shortIsOurs = !claimedShort?.value || claimedShort.value.hash === hash;
    if (shortIsOurs) {
      await store.put(
        paths.shortcut(shortHash),
        JSON.stringify({ hash, at }),
        { contentType: 'application/json', maxAge: 60 }
      );
    }

    await store.put(
      paths.alias(displayId),
      JSON.stringify({ hash, tokenHash: hashToken(editToken), at }),
      // Both pointers carry the clock a read slides forward, so neither may sit
      // in an edge cache long enough to hide that it has moved or expired.
      { contentType: 'application/json', maxAge: 60 }
    );

    return send(res, 200, {
      hash,
      shortHash: shortIsOurs ? shortHash : null,
      displayId,
      editToken,
      claimed: !existing?.value,
      bytes,
      // Null when retention is switched off. Shown next to the link, because a
      // lifetime nobody was told about is one they find out about in three
      // months, from a document that has already been shared.
      expiresAt: expiryOf(at, retentionDays(process.env)),
      retentionDays: retentionDays(process.env),
    });
  } catch (err) {
    console.error('store failed', err);
    return fail(res, 502, 'The diagram could not be stored. The storage backend refused it.');
  }
}
