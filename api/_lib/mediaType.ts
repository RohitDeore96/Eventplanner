/**
 * Standards-conscious `Content-Type` parsing for the JSON body gate (stage-2 defect C).
 * The media type alone decides — RFC 9110 makes types case-insensitive and parameters
 * legitimate — so `application/json; charset=utf-8` is accepted while lookalikes such as
 * `application/jsonp`, `application/json5` or a bare `text/plain` are not, no matter the
 * client's letter casing. Parameters are validated against the RFC grammar, so a
 * malformed header fails closed to the route's 415 instead of sneaking through a
 * substring test.
 */

/** RFC 9110 `token`: the alphabet for parameter names and unquoted values. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** RFC 9110 quoted-string: `"`-delimited, `\` escapes the next character. */
const QUOTED_STRING = /^"(?:[^"\\]|\\.)*"$/;

/**
 * True when the header names exactly the JSON media type with zero or more well-formed
 * parameters. Each `;` segment must be a `token=token` or `token="quoted string"` pair
 * appearing at most once: empty segments (`;`, `;;`), missing or empty values
 * (`charset`, `charset=`), empty or non-token names, duplicated names and unterminated
 * quotes are all rejected.
 */
export function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const segments = header.split(';');
  if ((segments[0]?.trim().toLowerCase() ?? '') !== 'application/json') return false;
  const seen = new Set<string>();
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=');
    if (eq <= 0) return false; // no '=', or an empty parameter name
    const name = segment.slice(0, eq).trim().toLowerCase();
    const value = segment.slice(eq + 1).trim();
    if (!TOKEN.test(name) || seen.has(name)) return false;
    if (value.startsWith('"') ? !QUOTED_STRING.test(value) : !TOKEN.test(value)) return false;
    seen.add(name);
  }
  return true;
}
