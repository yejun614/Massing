/**
 * The sweeper. Runs on a schedule; deletes what has fallen out of use.
 *
 * Two passes, in this order and for a reason.
 *
 * 1. **Links.** Every alias and short record carries the timestamp a read
 *    slides forward. Past the retention window it goes.
 * 2. **Documents.** A document is kept by being pointed at. Once the links
 *    above have been removed, anything left in `diagrams/` that no surviving
 *    record names is unreachable, and unreachable is the definition of
 *    collectable here.
 *
 * Doing it the other way round would delete a document while a live link still
 * named it. Doing both in one pass would need the reference set before it was
 * finished being computed.
 *
 * There is no separate clock on a document, which is what makes this work: the
 * links are the only thing anyone can hold, so the links are the only thing
 * whose age means anything. A document orphaned by a republish is collected
 * once the short link to its content also goes unused -- not immediately,
 * because that short link is a real link somebody may have shared.
 *
 * Bounded per run. The store may be any size and the function has a deadline,
 * so it takes what it can and comes back tomorrow for the rest; nothing here
 * has to finish today.
 */

import { createBlobStore, paths } from '../_lib/blob.js';
import { send, fail, methodAllowed } from '../_lib/http.js';
import { retentionDays, isExpired, SWEEP_GRACE_MS } from '../_lib/policy.js';

/** Objects examined in one run, and objects deleted in one call. */
const MAX_SCAN = 4000;
const DELETE_BATCH = 100;

/**
 * Only the scheduler, or someone holding the same secret.
 *
 * Vercel sends `CRON_SECRET` as a bearer token on scheduled invocations. With
 * no secret set the endpoint is refused outright rather than left open: an
 * unauthenticated deletion endpoint is worse than a sweeper that never runs,
 * and "it did nothing" is a failure someone notices.
 */
function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

/** Every object under a prefix, up to `budget`. */
async function scan(store, prefix, budget) {
  const found = [];
  let cursor = null;
  do {
    const page = await store.list(prefix, { cursor });
    found.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor && found.length < budget);
  return found;
}

async function deleteAll(store, urls) {
  for (let at = 0; at < urls.length; at += DELETE_BATCH) {
    await store.remove(urls.slice(at, at + DELETE_BATCH));
  }
  return urls.length;
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET', 'POST'])) return;
  if (!authorised(req)) return fail(res, 401, 'This endpoint is for the scheduler.');

  const store = createBlobStore(process.env);
  if (!store.configured) {
    return fail(res, 503, 'Stored diagrams are not configured on this deployment.');
  }

  const days = retentionDays(process.env);
  if (!days) return send(res, 200, { swept: false, reason: 'Retention is switched off.' });

  const now = Date.now();
  try {
    // --- pass one: links that have gone unused ------------------------------
    const links = [
      ...(await scan(store, 'aliases/', MAX_SCAN / 2)),
      ...(await scan(store, 'short/', MAX_SCAN / 2)),
    ];

    const stale = [];
    const liveHashes = new Set();
    for (const link of links) {
      const record = await store.getJson(link.pathname);
      const at = record?.value?.at;
      // A record whose timestamp cannot be read falls back to when the store
      // last wrote it, which for anything written by this code is the same
      // moment. Unreadable both ways, it is left alone rather than guessed at.
      const stamp = at ?? link.uploadedAt;
      if (isExpired(stamp, days, now)) stale.push(link.url);
      else if (record?.value?.hash) liveHashes.add(record.value.hash);
    }
    const linksRemoved = await deleteAll(store, stale);

    // --- pass two: documents nothing points at any more ---------------------
    const documents = await scan(store, 'diagrams/', MAX_SCAN);
    const orphaned = documents
      .filter((doc) => {
        // A publish writes the document before its records, so a document that
        // has only just appeared may have no reference yet purely because this
        // run caught it mid-write.
        if (now - Date.parse(doc.uploadedAt) < SWEEP_GRACE_MS) return false;
        const hash = doc.pathname.slice('diagrams/'.length).replace('.arch.json', '');
        return !liveHashes.has(hash);
      })
      .map((doc) => doc.url);
    const documentsRemoved = await deleteAll(store, orphaned);

    const result = {
      swept: true,
      retentionDays: days,
      linksScanned: links.length,
      linksRemoved,
      documentsScanned: documents.length,
      documentsRemoved,
      // Said out loud so a store that has outgrown one run does not look like a
      // store that is being kept tidy.
      truncated: links.length >= MAX_SCAN || documents.length >= MAX_SCAN,
    };
    console.log('swept', result);
    return send(res, 200, result);
  } catch (err) {
    console.error('sweep failed', err);
    return fail(res, 502, `The sweep could not finish — ${err.message}`);
  }
}
