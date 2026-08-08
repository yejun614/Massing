/**
 * GET /api/flags — which hosted features this deployment is offering.
 *
 * The client asks once at start-up and shows or hides whole parts of the
 * interface on the answer. A feature that is off is not merely disabled: its
 * button is not there, because a control that exists only to explain that it
 * does not work is worse than no control.
 *
 * Cached for a short while at the edge. Long enough that a page load does not
 * cost an Edge Config read, short enough that turning something off in the
 * dashboard takes effect while you are still looking at the dashboard.
 */

import { currentFlags } from './_lib/flags.js';
import { send, fail, methodAllowed } from './_lib/http.js';

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return;
  try {
    const { flags, detail } = await currentFlags(process.env);
    send(res, 200, { flags, detail }, {
      'cache-control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300',
    });
  } catch (err) {
    // Never fatal. A deployment that cannot answer this is one where nothing
    // hosted is on, which is a working state rather than a broken one.
    console.error('flags failed', err);
    send(res, 200, { flags: { analytics: false, storage: false, assistant: false }, detail: {} });
  }
}
