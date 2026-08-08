/**
 * GET /api/diagrams/:key — read one back.
 *
 * The key is a full hash, a short hash, or a display id, told apart by shape.
 * That is why a display id may not look like hex: a URL carries no label saying
 * which of the three it is, so the shapes have to stay distinguishable.
 *
 * A hash is immutable, so its answer is cached hard. A name is not, so its
 * answer is cached briefly — long enough to absorb a link being opened by
 * everyone in a channel at once, short enough that re-pointing a name is
 * visible while you are still testing it.
 */

import { createBlobStore, paths } from '../_lib/blob.js';
import { send, fail, methodAllowed } from '../_lib/http.js';
import { classifyKey } from '../_lib/policy.js';

const IMMUTABLE = 'public, max-age=300, s-maxage=31536000, immutable';
const NAMED = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return;

  const store = createBlobStore(process.env);
  if (!store.configured) {
    return fail(res, 503, 'Stored diagrams are not configured on this deployment.');
  }

  const classified = classifyKey(req.query?.key ?? '');
  if (classified.error) return fail(res, 400, classified.error);

  try {
    let { kind, key } = classified;
    let hash = kind === 'hash' ? key : null;

    if (kind === 'short') {
      const found = await store.getJson(paths.shortcut(key));
      hash = found?.value?.hash ?? null;
    } else if (kind === 'display') {
      const found = await store.getJson(paths.alias(key));
      hash = found?.value?.hash ?? null;
    }
    if (!hash) return fail(res, 404, `Nothing is stored under "${classified.key}".`);

    const document = await store.get(paths.document(hash));
    if (!document) {
      // A pointer outliving what it points at. Worth its own message: the link
      // is not wrong, the thing behind it is gone.
      return fail(res, 404, `"${classified.key}" points at a diagram that is no longer stored.`);
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', kind === 'display' ? NAMED : IMMUTABLE);
    res.setHeader('x-massing-hash', hash);
    // The stored text verbatim rather than a re-serialisation, so what is read
    // is byte-for-byte what was written and the hash still describes it.
    res.end(document.text);
  } catch (err) {
    console.error('read failed', err);
    return fail(res, 502, 'The diagram could not be read. The storage backend refused it.');
  }
}
