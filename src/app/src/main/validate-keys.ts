import { request } from 'https'
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import { getPythonPath } from './python-env'
import { getEnvVars } from './env'

interface ValidationResult {
  ok: boolean
  error?: string
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

async function validateModal(tokenId: string, tokenSecret: string): Promise<ValidationResult> {
  try {
    const res = await httpsJson({
      hostname: 'api.modal.com',
      path: '/api/v1/apps',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenId}:${tokenSecret}`,
      },
    })
    if (res.status === 200 || res.status === 401) {
      // Modal returns 401 for bad tokens, 200 for valid
      if (res.status === 401) return { ok: false, error: 'Invalid Modal tokens' }
      return { ok: true }
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

const HF_REQUIRED_MODELS = [
  'pyannote/speaker-diarization-3.1',
  'pyannote/segmentation-3.0',
  'pyannote/embedding',
]

async function checkModelAccess(token: string, model: string): Promise<{ ok: boolean; error?: string }> {
  const res = await httpsJson({
    hostname: 'huggingface.co',
    path: `/api/models/${model}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  if (res.status === 200) return { ok: true }
  if (res.status === 401) return { ok: false, error: `Invalid token` }
  if (res.status === 403) return { ok: false, error: `Access denied for ${model} — accept the license on the model page` }
  if (res.status === 404) return { ok: false, error: `Model not found: ${model}` }
  return { ok: false, error: `${model}: unexpected response (${res.status})` }
}

async function validateHuggingFace(token: string): Promise<ValidationResult> {
  try {
    // First check the token is valid at all
    const whoami = await httpsJson({
      hostname: 'huggingface.co',
      path: '/api/whoami',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (whoami.status === 401) return { ok: false, error: 'Invalid Hugging Face token' }

    // Then check access to each required model
    for (const model of HF_REQUIRED_MODELS) {
      const result = await checkModelAccess(token, model)
      if (!result.ok) return { ok: false, error: result.error }
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

async function validateClaude(apiKey: string): Promise<ValidationResult> {
  try {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
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
        if (err) {
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
