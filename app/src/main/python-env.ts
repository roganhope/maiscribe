import { spawn, execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'
import { get as httpsGet } from 'https'
import { IncomingMessage } from 'http'

const PYTHON_VERSION = '3.12.7'
const STANDALONE_TAG = '20241016'
const PACKAGES = ['modal', 'anthropic']

type Status = {
  state: 'idle' | 'downloading' | 'extracting' | 'creating-venv' | 'installing' | 'ready' | 'error'
  message: string
}

let currentStatus: Status = { state: 'idle', message: '' }
let statusCallback: ((status: Status) => void) | null = null
let setupPromise: Promise<void> | null = null

function getEnvDir(): string {
  return join(app.getPath('userData'), 'python-env')
}

function getPlatformTriple(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  throw new Error(`Unsupported platform: ${process.platform}`)
}

function getDownloadUrl(): string {
  const triple = getPlatformTriple()
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return `https://github.com/indygreg/python-build-standalone/releases/download/${STANDALONE_TAG}/cpython-${PYTHON_VERSION}+${STANDALONE_TAG}-${triple}-install_only.${ext}`
}

function getPythonDir(): string {
  return join(getEnvDir(), 'python')
}

function getVenvDir(): string {
  return join(getEnvDir(), 'venv')
}

export function getPythonPath(): string {
  const venvDir = getVenvDir()
  if (process.platform === 'win32') return join(venvDir, 'Scripts', 'python.exe')
  return join(venvDir, 'bin', 'python')
}

function getBasePythonPath(): string {
  const pythonDir = getPythonDir()
  if (process.platform === 'win32') return join(pythonDir, 'python.exe')
  return join(pythonDir, 'bin', 'python3')
}

function setStatus(state: Status['state'], message: string) {
  currentStatus = { state, message }
  statusCallback?.(currentStatus)
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function doGet(targetUrl: string) {
      httpsGet(targetUrl, (res: IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        const file = createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', reject)
      }).on('error', reject)
    }
    doGet(url)
  })
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['xzf', archivePath, '-C', destDir], { stdio: 'pipe' })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

async function provisionPython(): Promise<void> {
  const envDir = getEnvDir()
  const pythonDir = getPythonDir()
  const venvDir = getVenvDir()

  mkdirSync(envDir, { recursive: true })

  // Download standalone Python
  setStatus('downloading', 'Downloading Python runtime...')
  const url = getDownloadUrl()
  const archivePath = join(envDir, 'python.tar.gz')
  await download(url, archivePath)

  // Extract
  setStatus('extracting', 'Extracting Python...')
  if (existsSync(pythonDir)) rmSync(pythonDir, { recursive: true })
  await extractTarGz(archivePath, envDir)
  rmSync(archivePath, { force: true })

  // Create venv
  setStatus('creating-venv', 'Creating virtual environment...')
  const basePython = getBasePythonPath()
  execFileSync(basePython, ['-m', 'venv', venvDir], { stdio: 'pipe' })

  // Install packages
  setStatus('installing', 'Installing dependencies...')
  const pip = process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'pip.exe')
    : join(venvDir, 'bin', 'pip')
  execFileSync(pip, ['install', ...PACKAGES], { stdio: 'pipe', timeout: 120_000 })

  setStatus('ready', 'Python environment ready')
}

export function isEnvReady(): boolean {
  return existsSync(getPythonPath())
}

export async function ensurePythonEnv(): Promise<void> {
  if (isEnvReady()) {
    setStatus('ready', 'Python environment ready')
    return
  }
  if (setupPromise) return setupPromise
  setupPromise = provisionPython().catch((err) => {
    setStatus('error', err.message)
    setupPromise = null
    throw err
  })
  return setupPromise
}

export function getStatus(): Status {
  return currentStatus
}

export function registerPythonEnvIpc(): void {
  ipcMain.handle('python-env:status', () => currentStatus)
  ipcMain.handle('python-env:ensure', async () => {
    try {
      await ensurePythonEnv()
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })
}

export function onStatusChange(cb: (status: Status) => void): void {
  statusCallback = cb
}
