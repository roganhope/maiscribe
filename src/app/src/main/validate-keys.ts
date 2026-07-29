import { request } from 'https'
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import { getPythonPath } from './python-env'
import { getEnvVars } from './env'
import type { ModalWorkspace } from '../shared/types'

interface ValidationResult {
  ok: boolean
  error?: string
}

interface ModalValidationResult extends ValidationResult {
  workspace?: ModalWorkspace
}

function httpsJson(options: {
  hostname: string
  path: string
  method: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }))
      }
    )
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')) })
    if (options.body) req.write(options.body)
    req.end()
  })
}

// The modal CLI prints errors inside a rich-formatted box, so the last line of
// stderr is box-drawing characters rather than the reason.
const BOX_CHARS = '─│╭╮╰╯━┃┏┓┗┛═║╔╗╚╝┌┐└┘├┤┬┴┼ '

export function cleanModalCliError(text: string): string {
  const stripped = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  for (const raw of stripped.split('\n')) {
    let line = raw.trim()
    while (line.length && BOX_CHARS.includes(line[0])) line = line.slice(1)
    while (line.length && BOX_CHARS.includes(line[line.length - 1])) line = line.slice(0, -1)
    line = line.trim()
    if (!line || line.toLowerCase() === 'error') continue
    return line
  }
  return ''
}

/**
 * `modal token info` prints "Workspace: name (ws-id)".
 *
 * Both halves matter. The name is what a user recognises, but it is editable in
 * Modal's settings, so identity has to compare on the parenthesised ID instead —
 * see compareWorkspace in shared/workspace.ts.
 *
 * The ID stays optional: not every Modal build prints one, and a missing ID has
 * to degrade to a name comparison rather than break the check.
 */
export function parseModalWorkspace(stdout: string): ModalWorkspace | undefined {
  for (const line of stdout.split('\n')) {
    if (!line.includes('Workspace:')) continue
    const after = line.split('Workspace:')[1]
    const name = after.split('(')[0].trim()
    if (!name) continue
    // Anything inside the parens, rather than a `ws-` prefix we would have to
    // keep in sync with Modal's ID format.
    const id = after.match(/\(([^)]+)\)/)?.[1].trim()
    return id ? { name, id } : { name }
  }
  return undefined
}

/**
 * Validate Modal credentials by making a genuinely authenticated call.
 *
 * This deliberately does NOT use `GET api.modal.com/api/v1/apps`, which is what
 * it used to do. That endpoint returns 200 for bogus tokens and even with no
 * Authorization header at all, so the check passed for anything the user pasted
 * — and since the wizard's Next button is gated on the result, a mistyped token
 * unlocked setup and only failed much later, mid-transcription.
 *
 * `modal token info` is a real control-plane call under the venv Python, the
 * same interpreter the pipeline runs on. It also returns the workspace name,
 * which catches a token pasted from the wrong account.
 */
async function validateModal(tokenId: string, tokenSecret: string): Promise<ModalValidationResult> {
  // Defence in depth: the renderer trims too, but this handles any other caller.
  // A pasted token often carries a trailing space or newline, which Modal reports
  // as "Token ID is malformed" — an error that points nowhere near the cause.
  tokenId = (tokenId || '').trim()
  tokenSecret = (tokenSecret || '').trim()

  // An empty half means "use what is already stored". `env:get` masks its values
  // (env.ts:33), so a renderer that filled the gap from there would send literal
  // bullet characters and Modal would reject a token the user never typed.
  const stored = getEnvVars()
  if (!tokenId) tokenId = (stored.MODAL_TOKEN_ID || '').trim()
  if (!tokenSecret) tokenSecret = (stored.MODAL_TOKEN_SECRET || '').trim()

  if (!tokenId || !tokenSecret) {
    return { ok: false, error: 'Enter both a token ID and a token secret.' }
  }

  const pythonPath = getPythonPath()
  const env = {
    ...process.env,
    ...getEnvVars(),
    MODAL_TOKEN_ID: tokenId,
    MODAL_TOKEN_SECRET: tokenSecret,
    // Stop rich from colouring output we have to parse.
    NO_COLOR: '1',
    TERM: 'dumb',
  }

  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ['-m', 'modal', 'token', 'info'],
      { env, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = cleanModalCliError(stderr || stdout) || err.message
          resolve({ ok: false, error: `Modal rejected these tokens: ${detail}` })
          return
        }
        resolve({ ok: true, workspace: parseModalWorkspace(stdout) })
      }
    )
  })
}

const HF_REQUIRED_MODELS = [
  'pyannote/speaker-diarization-3.1',
  'pyannote/segmentation-3.0',
  'pyannote/embedding',
]

async function checkModelAccess(token: string, model: string): Promise<{ ok: boolean; error?: string }> {
  for (const file of ['config.yaml', 'config.json']) {
    const res = await httpsJson({
      hostname: 'huggingface.co',
      path: `/${model}/resolve/main/${file}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
    if (res.status === 200 || res.status === 307) return { ok: true }
    if (res.status === 401) return { ok: false, error: `Invalid token` }
    if (res.status === 403) return { ok: false, error: `Access denied — accept the license at huggingface.co/${model}` }
    if (res.status === 404) continue
  }
  return { ok: false, error: `Could not verify access for ${model}` }
}

interface HfValidationResult extends ValidationResult {
  models?: { model: string; ok: boolean; error?: string }[]
}

async function validateHuggingFace(token: string): Promise<HfValidationResult> {
  token = token.trim()
  if (!token) return { ok: false, error: 'Enter a Hugging Face token.', models: [] }
  try {
    const models: { model: string; ok: boolean; error?: string }[] = []
    let allOk = true
    for (const model of HF_REQUIRED_MODELS) {
      const result = await checkModelAccess(token, model)
      models.push({ model, ok: result.ok, error: result.error })
      if (!result.ok) allOk = false
    }
    return { ok: allOk, models, error: allOk ? undefined : 'Some models require license acceptance' }
  } catch (err: any) {
    return { ok: false, error: err.message, models: [] }
  }
}

async function validateClaude(apiKey: string): Promise<ValidationResult> {
  apiKey = apiKey.trim()
  if (!apiKey) return { ok: false, error: 'Enter an API key.' }
  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    })
    const res = await httpsJson({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      },
      body,
    })
    if (res.status === 200) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Invalid API key' }
    if (res.status === 403) return { ok: false, error: 'API key lacks permission' }
    // 400 with valid auth means the key works but request is bad (unlikely with our payload)
    if (res.status === 400) return { ok: true }
    return { ok: false, error: `Unexpected response (${res.status})` }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

async function syncModalSecret(
  hfToken: string,
  modalTokenId: string,
  modalTokenSecret: string
): Promise<ValidationResult> {
  // A stray newline here would be written into the secret itself, so the GPU
  // container would receive a token that fails only at model-download time.
  hfToken = hfToken.trim()
  modalTokenId = modalTokenId.trim()
  modalTokenSecret = modalTokenSecret.trim()

  const pythonPath = getPythonPath()
  const envVars = getEnvVars()
  const env = {
    ...process.env,
    ...envVars,
    MODAL_TOKEN_ID: modalTokenId,
    MODAL_TOKEN_SECRET: modalTokenSecret,
  }

  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ['-m', 'modal', 'secret', 'create', 'huggingface', `HUGGING_FACE_HUB_TOKEN=${hfToken}`],
      { env, timeout: 30_000 },
      (err, _stdout, stderr) => {
        if (err && stderr.includes('already exists')) {
          execFile(
            pythonPath,
            ['-m', 'modal', 'secret', 'delete', 'huggingface', '--yes'],
            { env, timeout: 30_000 },
            (err2) => {
              if (err2) {
                resolve({ ok: false, error: 'Failed to replace existing secret' })
                return
              }
              execFile(
                pythonPath,
                ['-m', 'modal', 'secret', 'create', 'huggingface', `HUGGING_FACE_HUB_TOKEN=${hfToken}`],
                { env, timeout: 30_000 },
                (err3, _stdout3, stderr3) => {
                  if (err3) {
                    resolve({ ok: false, error: stderr3.trim() || err3.message })
                  } else {
                    resolve({ ok: true })
                  }
                }
              )
            }
          )
        } else if (err) {
          resolve({ ok: false, error: stderr.trim() || err.message })
        } else {
          resolve({ ok: true })
        }
      }
    )
  })
}

export function registerValidateKeysIpc(): void {
  ipcMain.handle('validate:modal', (_event, tokenId: string, tokenSecret: string) =>
    validateModal(tokenId, tokenSecret)
  )
  ipcMain.handle('validate:huggingface', (_event, token: string) =>
    validateHuggingFace(token)
  )
  ipcMain.handle('validate:claude', (_event, apiKey: string) =>
    validateClaude(apiKey)
  )
  ipcMain.handle('validate:syncModalSecret', (_event, hfToken: string, modalTokenId: string, modalTokenSecret: string) =>
    syncModalSecret(hfToken, modalTokenId, modalTokenSecret)
  )
  ipcMain.handle('validate:syncModalSecretFromEnv', () => {
    const vars = getEnvVars()
    const hf = vars.HF_TOKEN
    const modalId = vars.MODAL_TOKEN_ID
    const modalSecret = vars.MODAL_TOKEN_SECRET
    if (!hf || !modalId || !modalSecret) {
      return { ok: false, error: 'Modal tokens and HF token must all be set first' } as ValidationResult
    }
    return syncModalSecret(hf, modalId, modalSecret)
  })
}
