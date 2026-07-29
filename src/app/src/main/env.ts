import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'

function envPath(): string {
  return join(app.getPath('userData'), '.env')
}

export function getEnvVars(): Record<string, string> {
  const path = envPath()
  if (!existsSync(path)) return {}
  const lines = readFileSync(path, 'utf-8').split('\n')
  const vars: Record<string, string> = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    vars[key] = value
  }
  return vars
}

let envCallback: (() => void) | null = null

export function onEnvChange(cb: () => void): void {
  envCallback = cb
}

export function setEnvVars(vars: Record<string, string>): void {
  const existing = getEnvVars()
  const merged = { ...existing, ...vars }
  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  writeFileSync(envPath(), content, 'utf-8')
  envCallback?.()
}

export function registerEnvIpc(): void {
  ipcMain.handle('env:get', () => {
    const vars = getEnvVars()
    const masked: Record<string, string> = {}
    for (const [k, v] of Object.entries(vars)) {
      masked[k] = v ? '••••••••' : ''
    }
    return masked
  })
  ipcMain.handle('env:set', (_event, vars: Record<string, string>) => {
    setEnvVars(vars)
  })
}
