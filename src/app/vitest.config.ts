import { defineConfig } from 'vitest/config'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Load `.env.test` into the test environment.
 *
 * Keeps credential-shaped fixtures out of the repo. The file is gitignored; see
 * `.env.test.example` for the keys it may define. Parsed here rather than with a
 * dotenv dependency because the app already parses .env this way (`env.ts`).
 *
 * Every test must still pass without the file — anything reading these values
 * falls back to an obvious placeholder, since the tests that use them only care
 * about the shape of a string, never its authenticity.
 */
function loadEnvTest(): Record<string, string> {
  const path = resolve(__dirname, '.env.test')
  if (!existsSync(path)) return {}

  const env: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

export default defineConfig({
  test: {
    env: loadEnvTest(),
  },
})
