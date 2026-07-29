import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '/tmp/maiscribe-userdata' },
}))

import { cleanModalCliError, parseModalWorkspace } from './validate-keys'
import { compareWorkspace, workspaceLineState } from '../shared/workspace'

describe('parseModalWorkspace', () => {
  it('pulls the workspace name and id out of `modal token info`', () => {
    const stdout = 'Token: ak-123\nWorkspace: acme-labs (ws-9)\nUser: someone\n'
    expect(parseModalWorkspace(stdout)).toEqual({ name: 'acme-labs', id: 'ws-9' })
  })

  it('handles a workspace line with no id in parentheses', () => {
    expect(parseModalWorkspace('Workspace: acme-labs')).toEqual({ name: 'acme-labs' })
  })

  it('does not assume the id starts with ws-', () => {
    expect(parseModalWorkspace('Workspace: acme-labs (org_12345)')).toEqual({
      name: 'acme-labs',
      id: 'org_12345',
    })
  })

  it('returns undefined when there is no workspace line', () => {
    expect(parseModalWorkspace('Token: ak-123')).toBeUndefined()
  })

  it('returns undefined rather than an empty string for a blank name', () => {
    expect(parseModalWorkspace('Workspace: ')).toBeUndefined()
  })
})

describe('compareWorkspace', () => {
  const stored = (id: string | null, name: string | null) => ({
    workspaceId: id,
    workspaceName: name,
    provisionedAt: null,
  })

  it('treats an empty config as first setup', () => {
    expect(compareWorkspace(null, { name: 'acme', id: 'ws-1' })).toEqual({ kind: 'first-setup' })
    expect(compareWorkspace(stored(null, null), { name: 'acme', id: 'ws-1' }))
      .toEqual({ kind: 'first-setup' })
  })

  it('matches on id', () => {
    expect(compareWorkspace(stored('ws-1', 'acme'), { name: 'acme', id: 'ws-1' }))
      .toEqual({ kind: 'same' })
  })

  it('reports a rename rather than a switch when the id still matches', () => {
    // The whole reason identity keys on the id: names are editable in Modal.
    expect(compareWorkspace(stored('ws-1', 'acme'), { name: 'acme-renamed', id: 'ws-1' }))
      .toEqual({ kind: 'renamed', from: 'acme', to: 'acme-renamed' })
  })

  it('reports a confident change when the ids differ', () => {
    expect(compareWorkspace(stored('ws-1', 'acme'), { name: 'other', id: 'ws-2' }))
      .toEqual({ kind: 'changed', from: 'acme', to: 'other', confident: true })
  })

  it('catches two different workspaces sharing a display name', () => {
    // Name comparison alone would call this the same workspace and skip the rebuild.
    expect(compareWorkspace(stored('ws-1', 'acme'), { name: 'acme', id: 'ws-2' }))
      .toEqual({ kind: 'changed', from: 'acme', to: 'acme', confident: true })
  })

  it('falls back to names, unconfidently, when the stored id is missing', () => {
    expect(compareWorkspace(stored(null, 'acme'), { name: 'other', id: 'ws-2' }))
      .toEqual({ kind: 'changed', from: 'acme', to: 'other', confident: false })
  })

  it('falls back to names, unconfidently, when the observed id is missing', () => {
    expect(compareWorkspace(stored('ws-1', 'acme'), { name: 'other' }))
      .toEqual({ kind: 'changed', from: 'acme', to: 'other', confident: false })
  })

  it('matches on name when neither side has an id', () => {
    expect(compareWorkspace(stored(null, 'acme'), { name: 'acme' })).toEqual({ kind: 'same' })
  })

  it('says nothing changed when the workspace could not be identified', () => {
    expect(compareWorkspace(stored('ws-1', 'acme'), undefined)).toEqual({ kind: 'same' })
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

describe('cleanModalCliError on real Modal failures', () => {
  // Verbatim stderr shapes seen from `modal token info`, so the messages the
  // user is shown stay tied to what the CLI actually emits.
  const cases: [string, string][] = [
    ['mismatched pair', 'Token validation failed'],
    ['whitespace in the id', 'Token ID is malformed'],
  ]

  for (const [label, message] of cases) {
    it(`extracts the reason for a ${label}`, () => {
      const boxed = [
        '╭─ Error ───────────────────────────────────╮',
        `│ ${message.padEnd(41)} │`,
        '╰───────────────────────────────────────────╯',
      ].join('\n')
      expect(cleanModalCliError(boxed)).toBe(message)
    })
  }

  it('handles a multi-line metadata error without swallowing the reason', () => {
    const stderr = "Invalid metadata value: 'as-token\n'"
    expect(cleanModalCliError(stderr)).toBe("Invalid metadata value: 'as-token")
  })
})

describe('workspaceLineState', () => {
  const modal = (name: string | null, provisionedAt: string | null) => ({
    workspaceId: 'ws-1',
    workspaceName: name,
    provisionedAt,
  })

  it('hides itself when no tokens are set', () => {
    expect(workspaceLineState(modal('acme', null), false)).toEqual({ kind: 'hidden' })
    expect(workspaceLineState(null, false)).toEqual({ kind: 'hidden' })
  })

  it('reports an unidentified workspace when tokens exist but nothing was recorded', () => {
    expect(workspaceLineState(null, true)).toEqual({ kind: 'unknown' })
    expect(workspaceLineState(modal(null, null), true)).toEqual({ kind: 'unknown' })
  })

  it('warns when the workspace is known but never provisioned', () => {
    expect(workspaceLineState(modal('acme', null), true))
      .toEqual({ kind: 'unprovisioned', name: 'acme' })
  })

  it('reports a provisioned workspace plainly', () => {
    expect(workspaceLineState(modal('acme', '2026-07-29T00:00:00.000Z'), true))
      .toEqual({ kind: 'ready', name: 'acme' })
  })
})
