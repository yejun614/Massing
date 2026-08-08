/**
 * The parts every handler repeats.
 *
 * Bodies are read with a hard ceiling rather than through the platform's own
 * parser, because a size limit that only applies after the whole request is in
 * memory is not a size limit. The socket is destroyed the moment the count is
 * passed.
 */

/** JSON out, with no caching unless the caller asks for some. */
export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', headers['cache-control'] ?? 'no-store');
  for (const [name, value] of Object.entries(headers)) {
    if (name !== 'cache-control') res.setHeader(name, value);
  }
  res.end(JSON.stringify(body));
}

/**
 * A refusal the interface can show as it stands.
 *
 * `error` is the sentence a person reads. Everything else is for the console,
 * and the split matters: a stack trace in a toast helps nobody, and "something
 * went wrong" in a log helps nobody either.
 */
export function fail(res, status, error, extra = {}) {
  send(res, status, { error, ...extra });
  return false;
}

/**
 * Read a JSON body, refusing anything past `limit` while it arrives.
 *
 * @returns {Promise<{ok: true, value: any, bytes: number} | {ok: false, status: number, error: string}>}
 */
export function readJson(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const stop = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        // Settle first, then destroy. Tearing the socket down raises `aborted`,
        // and that handler resolves too — so doing it the other way round
        // reports a cut-off request rather than the size that caused it.
        stop({ ok: false, status: 413, error: `That is larger than the ${Math.round(limit / 1024)} kB limit.` });
        // A client still uploading needs to be told now, not when it finishes.
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('aborted', () => stop({ ok: false, status: 400, error: 'The request was cut short.' }));
    req.on('error', () => stop({ ok: false, status: 400, error: 'The request could not be read.' }));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return stop({ ok: false, status: 400, error: 'The request had no body.' });
      try {
        stop({ ok: true, value: JSON.parse(text), bytes, text });
      } catch (err) {
        stop({ ok: false, status: 400, error: `The body is not valid JSON: ${err.message}` });
      }
    });
  });
}

/**
 * Who is asking, for rate limiting.
 *
 * `x-forwarded-for` is the only thing available behind the platform's proxy,
 * and the left-most entry is the client as the edge saw it. It can be forged
 * upstream of nothing here, which is another way of saying these counters are a
 * brake rather than a gate.
 */
export function callerKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** Refuse anything but the methods a handler actually implements. */
export function methodAllowed(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('allow', allowed.join(', '));
  fail(res, 405, `${req.method} is not allowed here.`);
  return false;
}

/**
 * An optional shared secret on the writing endpoints.
 *
 * Unset, the deployment is open and the rate limits are what stand between it
 * and a bill. Set, every write has to carry it — which is the configuration for
 * a deployment that is public to read and private to write, and the one to
 * reach for if the URL ever gets around.
 */
export function writeTokenAccepted(req, env = process.env) {
  const expected = env.MASSING_WRITE_TOKEN;
  if (!expected) return true;
  const given = String(req.headers['x-massing-token'] ?? '');
  return given.length === expected.length && given === expected;
}
