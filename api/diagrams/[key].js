/**
 * GET /api/diagrams/:key — read one back, and keep it alive by reading it.
 *
 * The key is a full hash, a short hash, or a display id, told apart by shape.
 * That is why a display id may not look like hex: a URL carries no label saying
 * which of the three it is, so the shapes have to stay distinguishable.
 *
 * Retention is sliding, and this is where it slides. A link that is opened has
 * its clock reset; one that is not eventually falls past the cutoff and the
 * sweeper takes it. Reading is therefore not quite a read — it writes, at most
 * once a week per link, which is what keeps that from being a write behind
 * every GET.
 *
 * An expired link answers 410 rather than 404. "Gone" and "never existed" are
 * different things to whoever followed the link, and the difference is the only
 * useful thing left to tell them.
 */

import { createBlobStore, paths } from '../_lib/blob.js';
import { send, fail, methodAllowed } from '../_lib/http.js';
import {
  classifyKey,
  retentionDays,
  isExpired,
  shouldRefresh,
  expiryOf,
  cacheSeconds,
  SHORT_HASH_LENGTH,
} from '../_lib/policy.js';

/** Ceilings, before the remaining lifetime is allowed to cut them down. */
const HASH_CEILING = 31536000;
const NAME_CEILING = 60;

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return;

  const store = createBlobStore(process.env);
  if (!store.configured) {
    return fail(res, 503, 'Stored diagrams are not configured on this deployment.');
  }

  const classified = classifyKey(req.query?.key ?? '');
  if (classified.error) return fail(res, 400, classified.error);

  const days = retentionDays(process.env);

  try {
    const { kind, key } = classified;

    /*
     * Which record carries this link's clock.
     *
     * A name has its own. A short hash has its own. A bare full hash borrows
     * the short record for its own prefix -- which is the same record in every
     * case except the forty-bit collision, and there the document is being kept
     * alive by whatever else points at it, so serving it unclocked is right.
     */
    const clockPath = kind === 'display'
      ? paths.alias(key)
      : paths.shortcut(kind === 'short' ? key : key.slice(0, SHORT_HASH_LENGTH));

    const record = await store.getJson(clockPath);
    let hash = kind === 'hash' ? key : record?.value?.hash ?? null;
    const clocked = record?.value && (kind !== 'hash' || record.value.hash === key);

    if (!hash) return fail(res, 404, `Nothing is stored under "${classified.key}".`);

    if (clocked && isExpired(record.value.at, days, Date.now())) {
      return fail(res, 410, `"${classified.key}" expired on ${expiryOf(record.value.at, days).slice(0, 10)}. Published diagrams are kept for ${days} days after they are last opened.`, {
        expiredAt: expiryOf(record.value.at, days),
      });
    }

    const document = await store.get(paths.document(hash));
    if (!document) {
      // A pointer outliving what it points at. Worth its own message: the link
      // is not wrong, the thing behind it is gone.
      return fail(res, 404, `"${classified.key}" points at a diagram that is no longer stored.`);
    }

    /*
     * Slide the clock, before answering rather than after.
     *
     * A function may be frozen the moment its response ends, so work left
     * running past that point is work that may simply not happen -- and a
     * refresh that only lands sometimes is a link that expires while in use.
     * It costs a small write, at most once a week per link.
     */
    let at = record?.value?.at;
    if (clocked && shouldRefresh(at, days)) {
      at = new Date().toISOString();
      try {
        await store.put(clockPath, JSON.stringify({ ...record.value, at }), {
          contentType: 'application/json',
          maxAge: 60,
        });
      } catch (err) {
        // Not fatal. The link still resolves; it just did not gain a week, and
        // the next reader will try again.
        console.error('refresh failed', err);
        at = record.value.at;
      }
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader(
      'cache-control',
      `public, max-age=0, s-maxage=${cacheSeconds(at, days, kind === 'display' ? NAME_CEILING : HASH_CEILING)}, stale-while-revalidate=600`
    );
    res.setHeader('x-massing-hash', hash);
    if (clocked && days) res.setHeader('x-massing-expires', expiryOf(at, days) ?? '');
    // The stored text verbatim rather than a re-serialisation, so what is read
    // is byte-for-byte what was written and the hash still describes it.
    res.end(document.text);
  } catch (err) {
    console.error('read failed', err);
    return fail(res, 502, 'The diagram could not be read. The storage backend refused it.');
  }
}
