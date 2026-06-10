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
    return join(process.resourcesPath, 'pipeline')
  }
  return join(getRepoRoot(), 'src', 'pipeline')
}

function defaultBasePath(): string {
  return join(app.getPath('documents'), 'maiscribe')
}

function defaultConfig(): AppConfig {
  return {
    version: 1,
    basePath: defaultBasePath(),
    pipeline: {
      audioHandling: 'store',
      autoWatch: true,
      autoSummarize: true,
    },
    obsidian: {
      enabled: false,
      vaultPath: null,
      outputFolder: null,
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
  if (dirty) writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return config as AppConfig
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
    setConfig(config)
    mkdirSync(join(config.basePath, 'inbox'), { recursive: true })
    mkdirSync(join(config.basePath, 'outbox'), { recursive: true })
  })
  ipcMain.handle('config:defaultBasePath', () => defaultBasePath())
}
