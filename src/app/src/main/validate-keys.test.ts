import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '/tmp/maiscribe-userdata' },
}))

import { cleanModalCliError, parseModalWorkspace } from './validate-keys'

describe('parseModalWorkspace', () => {
  it('pulls the workspace name out of `modal token info`', () => {
    const stdout = 'Token: ak-123\nWorkspace: acme-labs (ws-9)\nUser: someone\n'
    expect(parseModalWorkspace(stdout)).toBe('acme-labs')
  })

  it('handles a workspace line with no id in parentheses', () => {
    expect(parseModalWorkspace('Workspace: acme-labs')).toBe('acme-labs')
  })

  it('returns undefined when there is no workspace line', () => {
    expect(parseModalWorkspace('Token: ak-123')).toBeUndefined()
  })

  it('returns undefined rather than an empty string for a blank name', () => {
    expect(parseModalWorkspace('Workspace: ')).toBeUndefined()
  })
})

describe('cleanModalCliError', () => {
  it('unwraps the rich-formatted box the modal CLI prints', () => {
    // Taking the last line of stderr yields box-drawing characters, not the reason.
    const boxed = [
      '╭───────────────── Error ─────────────────╮',
      '│ Token not found                         │',
      '╰─────────────────────────────────────────╯',
    ].join('\n')
    expect(cleanModalCliError(boxed)).toBe('Token not found')
  })

  it('strips ANSI escape sequences', () => {
    expect(cleanModalCliError('\x1b[31mboom\x1b[0m')).toBe('boom')
  })

  it('skips the bare "Error" heading', () => {
    expect(cleanModalCliError('Error\nthe real reason')).toBe('the real reason')
  })

  it('returns an empty string when there is nothing usable', () => {
    expect(cleanModalCliError('\n   \n')).toBe('')
  })

  it('leaves an ordinary message untouched', () => {
    expect(cleanModalCliError('connection refused')).toBe('connection refused')
  })
})
