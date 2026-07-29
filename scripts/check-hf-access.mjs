#!/usr/bin/env node
// Standalone Hugging Face gated-model access checker.
// Mirrors the eligibility logic in src/app/src/main/validate-keys.ts
// (validateHuggingFace / checkModelAccess) with no Electron dependency.
//
// Usage:
//   node scripts/check-hf-access.mjs <HF_TOKEN>
//   HF_TOKEN=hf_xxx node scripts/check-hf-access.mjs
//
// Exits 0 if all models are accessible, 1 otherwise.

import { request } from 'node:https'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The model list is data, not code — src/pipeline/models.json is the single
// source of truth that scripts/check_hf.py also reads. Adding a model there
// means this script picks it up with no change here.
const MANIFEST = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'src', 'pipeline', 'models.json'
)
const HF_REQUIRED_MODELS = JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  .models.map((m) => m.repo)

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.end()
  })
}

async function checkModelAccess(token, model) {
  for (const file of ['config.yaml', 'config.json']) {
    const res = await httpsGet({
      hostname: 'huggingface.co',
      path: `/${model}/resolve/main/${file}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 200 || res.status === 307) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Invalid token' }
    if (res.status === 403) return { ok: false, error: `Access denied — accept the license at huggingface.co/${model}` }
    if (res.status === 404) continue
  }
  return { ok: false, error: `Could not verify access for ${model}` }
}

async function main() {
  const token = process.argv[2] || process.env.HF_TOKEN
  if (!token) {
    console.error('Error: no token provided.')
    console.error('Usage: node scripts/check-hf-access.mjs <HF_TOKEN>')
    console.error('   or: HF_TOKEN=hf_xxx node scripts/check-hf-access.mjs')
    process.exit(2)
  }

  console.log('Checking Hugging Face access for required pyannote models...\n')

  let allOk = true
  for (const model of HF_REQUIRED_MODELS) {
    const result = await checkModelAccess(token, model)
    if (result.ok) {
      console.log(`  PASS  ${model}`)
    } else {
      allOk = false
      console.log(`  FAIL  ${model} — ${result.error}`)
    }
  }

  console.log('')
  if (allOk) {
    console.log('All models accessible. HF token is eligible.')
    process.exit(0)
  } else {
    console.log('Some models are not accessible. Accept the licenses above, then retry.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message)
  process.exit(1)
})
