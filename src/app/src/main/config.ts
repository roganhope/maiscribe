import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'
import type { AppConfig } from '../shared/types'

function userDataDir(): string {
  return app.getPath('userData')
}

function configPath(): string {
  return join(userDataDir(), 'config.json')
}

function getRepoRoot(): string {
  return join(__dirname, '..', '..', '..', '..')
}

export function getSourceRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scripts')
  }
  return join(getRepoRoot(), 'src', 'scripts')
}

function defaultBasePath(): string {
  return join(app.getPath('documents'), 'maiscribe')
}

function defaultConfig(): AppConfig {
  return {
    version: 1,
    basePath: defaultBasePath(),
    pipeline: {
      audioHandling: 'leave',
      autoWatch: true,
      autoSummarize: true,
      minSpeakers: 2,
    },
    obsidian: {
      enabled: false,
      vaultPath: null,
      outputFolder: null,
    },
    modal: {
      workspaceId: null,
      workspaceName: null,
      provisionedAt: null,
    },
  }
}

export function migrateFromRepoRoot(): void {
  const repoRoot = getRepoRoot()
  const oldConfigPath = join(repoRoot, 'config.json')
  const oldEnvPath = join(repoRoot, '.env')
  const newConfigPath = configPath()
  const newEnvPath = join(userDataDir(), '.env')

  if (existsSync(oldConfigPath) && !existsSync(newConfigPath)) {
    const oldConfig = JSON.parse(readFileSync(oldConfigPath, 'utf-8'))
    if (oldConfig.basePath && oldConfig.basePath !== repoRoot) {
      mkdirSync(userDataDir(), { recursive: true })
      copyFileSync(oldConfigPath, newConfigPath)
    }
  }

  if (existsSync(newConfigPath) && existsSync(oldEnvPath) && !existsSync(newEnvPath)) {
    mkdirSync(userDataDir(), { recursive: true })
    copyFileSync(oldEnvPath, newEnvPath)
  }
}

export function getConfig(): AppConfig | null {
  const path = configPath()
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8')
  const config = JSON.parse(raw)
  let dirty = false
  if ('deleteAfterProcessing' in (config.pipeline || {})) {
    config.pipeline.audioHandling = config.pipeline.deleteAfterProcessing ? 'delete' : 'store'
    delete config.pipeline.deleteAfterProcessing
    dirty = true
  }
  if ('pythonPath' in config) {
    delete config.pythonPath
    dirty = true
  }
  if (config.pipeline && !('minSpeakers' in config.pipeline)) {
    config.pipeline.minSpeakers = 2
    dirty = true
  }
  // Configs written before workspace tracking existed. provisionedAt stays null
  // rather than being assumed — the workspace may well be provisioned already,
  // but nothing recorded it, and re-running setup is cheap when it is warm.
  if (!config.modal) {
    config.modal = { workspaceId: null, workspaceName: null, provisionedAt: null }
    dirty = true
  }
  if (dirty) writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return config as AppConfig
}

// Modal state is owned by this module, not by any renderer form. Anything that
// makes a workspace current notifies here so provisioning can react, rather than
// each caller having to remember to kick it off.
let workspaceCallback: (() => void) | null = null

export function onModalWorkspaceChange(cb: () => void): void {
  workspaceCallback = cb
}

/** Record the workspace a successful validation identified. */
export function setModalWorkspace(workspace: { id?: string; name: string }): void {
  const config = getConfig()
  if (!config) return
  const changed = config.modal.workspaceId
    ? workspace.id && config.modal.workspaceId !== workspace.id
    : config.modal.workspaceName && config.modal.workspaceName !== workspace.name
  setConfig({
    ...config,
    modal: {
      // Backfill: a config that only ever knew a name gains an ID the first
      // time one is seen, without a migration step.
      workspaceId: workspace.id ?? config.modal.workspaceId,
      workspaceName: workspace.name,
      provisionedAt: changed ? null : config.modal.provisionedAt,
    },
  })
  workspaceCallback?.()
}

export function markProvisioned(): void {
  const config = getConfig()
  if (!config) return
  setConfig({ ...config, modal: { ...config.modal, provisionedAt: new Date().toISOString() } })
}

/**
 * Persist a config supplied by the renderer, preserving main-owned Modal state.
 *
 * Renderer forms hold a draft copied at mount, so a save issued after
 * setModalWorkspace would write the stale modal block back over it and lose the
 * workspace that was just recorded.
 */
export function saveIncomingConfig(config: AppConfig): void {
  const current = getConfig()
  setConfig(current ? { ...config, modal: current.modal } : config)
}

export function setConfig(config: AppConfig): void {
  mkdirSync(userDataDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function ensureDataDirs(): void {
  const config = getConfig()
  if (!config) return
  mkdirSync(join(config.basePath, 'inbox'), { recursive: true })
  mkdirSync(join(config.basePath, 'outbox'), { recursive: true })
}

export function registerConfigIpc(): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_event, config: AppConfig) => {
    saveIncomingConfig(config)
    mkdirSync(join(config.basePath, 'inbox'), { recursive: true })
    mkdirSync(join(config.basePath, 'outbox'), { recursive: true })
  })
  ipcMain.handle('config:defaultBasePath', () => defaultBasePath())
  ipcMain.handle('config:setModalWorkspace', (_event, workspace: { id?: string; name: string }) =>
    setModalWorkspace(workspace)
  )
}
