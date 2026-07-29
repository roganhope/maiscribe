import { describe, it, expect } from 'vitest'
import { parseModalTokenCommand, maskToken } from './modalCommand'

const ID = 'ak-REDACTED-TOKEN-ID'
const SECRET = 'as-REDACTED-TOKEN-SECRET'

describe('parseModalTokenCommand', () => {
  it('parses the line Modal actually shows', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-id ${ID} --token-secret ${SECRET}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('accepts the flags in either order', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-secret ${SECRET} --token-id ${ID}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('accepts the = form', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-id=${ID} --token-secret=${SECRET}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('strips double and single quotes', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-id "${ID}" --token-secret '${SECRET}'`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('ignores a copied shell prompt', () => {
    expect(parseModalTokenCommand(
      `$ modal token set --token-id ${ID} --token-secret ${SECRET}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('reassembles a wrapped paste', () => {
    expect(parseModalTokenCommand(
      `modal token set \\\n  --token-id ${ID} \\\n  --token-secret ${SECRET}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('survives surrounding whitespace and newlines', () => {
    expect(parseModalTokenCommand(
      `\n\n   modal token set --token-id ${ID} --token-secret ${SECRET}   \n`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('ignores unrelated flags', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-id ${ID} --token-secret ${SECRET} --profile work --activate`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('parses when the tokens are not last', () => {
    expect(parseModalTokenCommand(
      `modal token set --profile work --token-id ${ID} --no-verify --token-secret ${SECRET}`
    )).toEqual({ tokenId: ID, tokenSecret: SECRET })
  })

  it('returns null when the secret is missing', () => {
    expect(parseModalTokenCommand(`modal token set --token-id ${ID}`)).toBeNull()
  })

  it('returns null when the id is missing', () => {
    expect(parseModalTokenCommand(`modal token set --token-secret ${SECRET}`)).toBeNull()
  })

  it('returns null for a flag with no value', () => {
    expect(parseModalTokenCommand(
      `modal token set --token-id --token-secret ${SECRET}`
    )).toBeNull()
  })

  it('returns null for unrelated text', () => {
    expect(parseModalTokenCommand('hello world')).toBeNull()
    expect(parseModalTokenCommand('')).toBeNull()
    expect(parseModalTokenCommand('   ')).toBeNull()
  })

  it('does not confuse token-id with token-secret', () => {
    // `--token-id` is a prefix of nothing here, but the reverse would match
    // loosely if the pattern were sloppy.
    const parsed = parseModalTokenCommand(
      `modal token set --token-secret ${SECRET} --token-id ${ID}`
    )
    expect(parsed?.tokenId).toBe(ID)
    expect(parsed?.tokenSecret).toBe(SECRET)
  })
})

describe('maskToken', () => {
  it('shows enough to recognise and no more', () => {
    expect(maskToken(ID)).toBe('ak-gWyAU…')
  })

  it('leaves short values alone', () => {
    expect(maskToken('ak-123')).toBe('ak-123')
  })
})
