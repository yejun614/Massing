/**
 * Turning an exception into something worth pasting into a bug report.
 *
 * Every error toast carries a Copy button, and this is what it copies. The
 * value of that text is entirely in the detail, so it is assembled in one
 * place rather than ad hoc at each catch site.
 */

/**
 * Message and stack, without the duplication.
 *
 * `err.stack` already starts with "Name: message" in every engine that
 * matters, so naively joining the message and the stack prints it twice.
 */
export function describeError(err) {
  const head = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
  const stack = typeof err?.stack === 'string' ? err.stack.trim() : '';
  if (!stack) return head;
  return stack.startsWith(head) ? stack : `${head}\n${stack}`;
}

/** Where and when it happened -- the questions every bug report is asked. */
export function describeEnvironment() {
  return [
    `when:  ${new Date().toISOString()}`,
    `where: ${location.href}`,
    `agent: ${navigator.userAgent}`,
  ].join('\n');
}

/**
 * A JSON syntax error is only actionable next to the text that caused it, so
 * point at the offending line with a caret under the column the parser
 * stopped at.
 */
export function describeParseFailure(sourceName, err, text) {
  const parts = [`${sourceName} is not valid JSON.`, describeError(err)];
  const at = Number(/position (\d+)/.exec(err?.message ?? '')?.[1]);

  if (Number.isFinite(at) && typeof text === 'string') {
    const before = text.slice(0, at);
    const line = before.split('\n').length;
    const column = at - before.lastIndexOf('\n') - 1;
    parts.push(
      '',
      `line ${line}, column ${column + 1}:`,
      text.split('\n')[line - 1] ?? '',
      ' '.repeat(Math.max(0, column)) + '^'
    );
  }
  return parts.join('\n');
}
