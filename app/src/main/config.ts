import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'
import type { AppConfig } from '../shared/types'

const PROJECT_ROOT = join(__dirname, '..', '..', '..')

function configPath(): string {
  return join(PROJECT_ROOT, 'config.json')
}

export function getConfig(): AppConfig | null {
  const path = configPath()
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as AppConfig
}

export function setConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function getProjectRoot(): string {
  return PROJECT_ROOT
}

export function registerConfigIpc(): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_event, config: AppConfig) => {
    setConfig(config)
  })
}
