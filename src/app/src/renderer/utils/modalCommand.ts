export interface ParsedModalCommand {
  tokenId: string
  tokenSecret: string
}

/**
 * Pull credentials out of the `modal token set` line Modal's UI hands the user.
 *
 * Modal shows the whole command, so making people dismantle it into two fields
 * by hand is where the stray-whitespace failures come from — Modal reports a
 * trailing newline as "Token ID is malformed", which points nowhere near the
 * cause. Accepting the line verbatim removes the step that introduces the bug.
 *
 * Tolerant on purpose: flags in either order, `--flag value` or `--flag=value`,
 * quoted values, a copied shell prompt, and line continuations from a wrapped
 * paste. Unrelated flags (`--profile`, `--activate`) are ignored rather than
 * rejected. Returns null when either token is missing.
 */
export function parseModalTokenCommand(text: string): ParsedModalCommand | null {
  if (!text) return null

  // A wrapped paste arrives with newlines and backslash continuations; both are
  // just whitespace once the line is reassembled.
  const flat = text.replace(/\\\s*\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!flat) return null

  const tokenId = extractFlag(flat, 'token-id')
  const tokenSecret = extractFlag(flat, 'token-secret')
  if (!tokenId || !tokenSecret) return null

  return { tokenId, tokenSecret }
}

function extractFlag(text: string, flag: string): string | null {
  // Either `--flag=value` or `--flag value`, with the value optionally quoted.
  const pattern = new RegExp(`--${flag}(?:\\s*=\\s*|\\s+)("[^"]*"|'[^']*'|\\S+)`)
  const match = text.match(pattern)
  if (!match) return null

  let value = match[1]
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  value = value.trim()

  // A following flag means the value was omitted, e.g. `--token-id --token-secret x`.
  if (!value || value.startsWith('--')) return null
  return value
}

/** Show enough of a token to confirm the right one was pasted, and no more. */
export function maskToken(token: string): string {
  if (token.length <= 8) return token
  return `${token.slice(0, 8)}…`
}
