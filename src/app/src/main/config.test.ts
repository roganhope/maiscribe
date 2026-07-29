import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'maiscribe-config-'))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => userData, isPackaged: false },
}))

import { getConfig, setConfig, saveIncomingConfig, setModalWorkspace, markProvisioned, onModalWorkspaceChange } from './config'

const base = {
  version: 1,
  basePath: '/tmp/base',
  pipeline: { audioHandling: 'store', autoWatch: true, autoSummarize: true, minSpeakers: 2 },
  obsidian: { enabled: false, vaultPath: null, outputFolder: null },
}

function write(config: any) {
  writeFileSync(join(userData, 'config.json'), JSON.stringify(config), 'utf-8')
}

function read() {
  return JSON.parse(readFileSync(join(userData, 'config.json'), 'utf-8'))
}

describe('modal block migration', () => {
  it('back-fills a config written before workspace tracking existed', () => {
    write(base)
    expect(getConfig()!.modal).toEqual({
      workspaceId: null,
      workspaceName: null,
      provisionedAt: null,
    })
  })
})

describe('setModalWorkspace', () => {
  beforeEach(() => write({ ...base, modal: { workspaceId: null, workspaceName: null, provisionedAt: null } }))

  it('records the workspace', () => {
    setModalWorkspace({ id: 'ac-1', name: 'acme' })
    expect(read().modal).toEqual({ workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: null })
  })

  it('backfills an id onto a config that only knew a name', () => {
    write({ ...base, modal: { workspaceId: null, workspaceName: 'acme', provisionedAt: '2026-01-01' } })
    setModalWorkspace({ id: 'ac-1', name: 'acme' })
    // Same workspace, so the provisioned stamp survives.
    expect(read().modal).toEqual({ workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: '2026-01-01' })
  })

  it('clears provisionedAt when the workspace actually changes', () => {
    write({ ...base, modal: { workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: '2026-01-01' } })
    setModalWorkspace({ id: 'ac-2', name: 'other' })
    expect(read().modal.provisionedAt).toBeNull()
  })

  it('keeps provisionedAt across a rename', () => {
    write({ ...base, modal: { workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: '2026-01-01' } })
    setModalWorkspace({ id: 'ac-1', name: 'acme-renamed' })
    expect(read().modal).toEqual({
      workspaceId: 'ac-1',
      workspaceName: 'acme-renamed',
      provisionedAt: '2026-01-01',
    })
  })

  it('notifies listeners so provisioning can react', () => {
    const cb = vi.fn()
    onModalWorkspaceChange(cb)
    setModalWorkspace({ id: 'ac-1', name: 'acme' })
    expect(cb).toHaveBeenCalled()
    onModalWorkspaceChange(() => {})
  })
})

describe('markProvisioned', () => {
  it('stamps the current workspace', () => {
    write({ ...base, modal: { workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: null } })
    markProvisioned()
    expect(read().modal.provisionedAt).toBeTruthy()
    expect(read().modal.workspaceId).toBe('ac-1')
  })
})

describe('saveIncomingConfig does not lose main-owned modal state', () => {
  it('still saves everything else the draft carries', () => {
    write({ ...base, modal: { workspaceId: 'ac-1', workspaceName: 'acme', provisionedAt: '2026-01-01' } })
    saveIncomingConfig({ ...base, basePath: '/tmp/moved' } as any)
    expect(read().basePath).toBe('/tmp/moved')
    expect(read().modal.provisionedAt).toBe('2026-01-01')
  })

  it('a stale renderer draft cannot clobber the recorded workspace', () => {
    // The regression: Settings copies config at mount, setModalWorkspace writes
    // the workspace, then the save wrote the stale draft back over it.
    write({ ...base, modal: { workspaceId: null, workspaceName: null, provisionedAt: null } })
    setModalWorkspace({ id: 'ac-1', name: 'acme' })

    const staleDraft = { ...base, modal: { workspaceId: null, workspaceName: null, provisionedAt: null } }
    saveIncomingConfig(staleDraft as any)

    expect(read().modal.workspaceId).toBe('ac-1')
    expect(read().modal.workspaceName).toBe('acme')
  })
})
