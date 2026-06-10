import { useState, useEffect } from 'react'
import type { AppConfig } from '../../shared/types'

type Step = 'folder' | 'modal' | 'huggingface' | 'claude' | 'options' | 'done'
const STEPS: Step[] = ['folder', 'modal', 'huggingface', 'claude', 'options', 'done']

interface Props {
  onComplete: (config: AppConfig) => void
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('folder')
  const [basePath, setBasePath] = useState('')

  useEffect(() => {
    window.api.config.defaultBasePath().then(setBasePath)
  }, [])
  const [modalTokenId, setModalTokenId] = useState('')
  const [modalTokenSecret, setModalTokenSecret] = useState('')
  const [hfToken, setHfToken] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [audioHandling, setAudioHandling] = useState<'store' | 'store-and-delete' | 'delete'>('store')
  const [autoWatch, setAutoWatch] = useState(true)
  const [autoSummarize, setAutoSummarize] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; models?: { model: string; ok: boolean; error?: string }[] } | null>(null)
  const [syncingSecret, setSyncingSecret] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; error?: string } | null>(null)

  async function selectFolder() {
    const path = await window.api.dialog.selectDirectory()
    if (path) setBasePath(path)
  }

  function resetTest() {
    setTestResult(null)
    setTesting(false)
  }

  async function testModal() {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.validate.modal(modalTokenId, modalTokenSecret)
    setTestResult(result)
    setTesting(false)
  }

  async function testHuggingFace() {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.validate.huggingFace(hfToken)
    setTestResult(result)
    setTesting(false)
  }

  async function testClaude() {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.validate.claude(claudeApiKey)
    setTestResult(result)
    setTesting(false)
  }

  async function finish() {
    const config: AppConfig = {
      version: 1,
      basePath,
      pipeline: {
        audioHandling,
        autoWatch,
        autoSummarize,
      },
      obsidian: {
        enabled: false,
        vaultPath: null,
        outputFolder: null,
      },
    }

    await window.api.config.set(config)
    const envVars: Record<string, string> = {}
    if (modalTokenId) envVars.MODAL_TOKEN_ID = modalTokenId
    if (modalTokenSecret) envVars.MODAL_TOKEN_SECRET = modalTokenSecret
    if (hfToken) envVars.HF_TOKEN = hfToken
    if (claudeApiKey) envVars.CLAUDE_API_KEY = claudeApiKey
    if (Object.keys(envVars).length) await window.api.env.set(envVars)

    if (modalTokenId && modalTokenSecret && hfToken) {
      setSyncingSecret(true)
      const result = await window.api.validate.syncModalSecret(hfToken, modalTokenId, modalTokenSecret)
      setSyncResult(result)
      setSyncingSecret(false)
    }

    onComplete(config)
  }

  function goNext(next: Step) {
    resetTest()
    setStep(next)
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="fixed inset-0 bg-gray-900/95 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
        <div className="flex gap-2 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded ${
                i <= stepIndex ? 'bg-accent-400' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {step === 'folder' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Storage Location</h2>
            <p className="text-sm text-gray-400 mb-4">
              Your recordings and transcriptions will be stored here. You can change this later in Settings.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              />
              <button
                onClick={selectFolder}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Change
              </button>
            </div>
            <button
              onClick={() => goNext('modal')}
              disabled={!basePath}
              className="mt-6 w-full py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
            >
              Next
            </button>
          </div>
        )}

        {step === 'modal' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Modal</h2>
            <div className="max-h-48 overflow-y-auto pr-2 mb-4 text-sm text-gray-400 space-y-3 scrollbar-thin scrollbar-thumb-gray-600">
              <p>
                Modal runs the transcription pipeline in the cloud — you won't need a GPU on your machine.
                It has a free tier that covers light usage.
              </p>
              <ol className="list-decimal list-inside space-y-2">
                <li>Go to <ExternalLink href="https://modal.com/signup">modal.com/signup</ExternalLink> and create a free account (GitHub or Google sign-in works)</li>
                <li>Once logged in, open <ExternalLink href="https://modal.com/settings">Settings → API Tokens</ExternalLink></li>
                <li>Click <strong className="text-gray-300">Create new token</strong></li>
                <li>You'll see a <strong className="text-gray-300">Token ID</strong> and <strong className="text-gray-300">Token Secret</strong> — copy both</li>
                <li>Paste them into the fields below and click <strong className="text-gray-300">Test Connection</strong></li>
              </ol>
              <p className="text-xs text-gray-500">
                The test only verifies your credentials — it doesn't start any containers or cost anything.
                Modal has a free tier as of June 2025, so whether you get charged depends on your usage.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-sm text-gray-400">Token ID</label>
                <input
                  type="password"
                  value={modalTokenId}
                  onChange={(e) => { setModalTokenId(e.target.value); resetTest() }}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Token Secret</label>
                <input
                  type="password"
                  value={modalTokenSecret}
                  onChange={(e) => { setModalTokenSecret(e.target.value); resetTest() }}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
                />
              </div>
            </div>

            <TestResult testing={testing} result={testResult} />

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => goNext('folder')}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Back
              </button>
              <button
                onClick={testModal}
                disabled={!modalTokenId || !modalTokenSecret || testing}
                className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 rounded font-medium"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={() => goNext('huggingface')}
                disabled={!testResult?.ok}
                className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
              >
                Next
              </button>
            </div>
            <button
              onClick={() => goNext('huggingface')}
              className="mt-2 w-full text-center text-sm text-gray-500 hover:text-gray-400"
            >
              Set up later
            </button>
          </div>
        )}

        {step === 'huggingface' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Hugging Face</h2>
            <div className="max-h-48 overflow-y-auto pr-2 mb-4 text-sm text-gray-400 space-y-3 scrollbar-thin scrollbar-thumb-gray-600">
              <p>
                Hugging Face hosts the speaker diarization models that identify who said what.
                You need a free account, an access token, and to accept the license for three models.
              </p>
              <ol className="list-decimal list-inside space-y-2">
                <li>Go to <ExternalLink href="https://huggingface.co/join">huggingface.co/join</ExternalLink> and create a free account</li>
                <li>Once logged in, accept the license on each of these model pages (click "Agree and access repository"):
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><ExternalLink href="https://huggingface.co/pyannote/speaker-diarization-3.1">pyannote/speaker-diarization-3.1</ExternalLink></li>
                    <li><ExternalLink href="https://huggingface.co/pyannote/segmentation-3.0">pyannote/segmentation-3.0</ExternalLink></li>
                    <li><ExternalLink href="https://huggingface.co/pyannote/embedding">pyannote/embedding</ExternalLink></li>
                  </ul>
                </li>
                <li>Go to <ExternalLink href="https://huggingface.co/settings/tokens">Settings → Access Tokens</ExternalLink></li>
                <li>Click <strong className="text-gray-300">Create new token</strong>, give it a name, and select <strong className="text-gray-300">Read</strong> access</li>
                <li>Copy the token and paste it below</li>
              </ol>
              <p className="text-xs text-gray-500">
                The test verifies your token and checks that you've accepted all three model licenses. It's free.
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-400">Access Token</label>
              <input
                type="password"
                value={hfToken}
                onChange={(e) => { setHfToken(e.target.value); resetTest() }}
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
              />
            </div>

            <HfTestResult testing={testing} result={testResult} />

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => goNext('modal')}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Back
              </button>
              <button
                onClick={testHuggingFace}
                disabled={!hfToken || testing}
                className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 rounded font-medium"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={() => goNext('claude')}
                disabled={!testResult?.ok}
                className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
              >
                Next
              </button>
            </div>
            <button
              onClick={() => goNext('claude')}
              className="mt-2 w-full text-center text-sm text-gray-500 hover:text-gray-400"
            >
              Set up later
            </button>
          </div>
        )}

        {step === 'claude' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Claude API</h2>
            <p className="text-sm text-gray-400 mb-4">
              Used to generate meeting summaries from transcriptions. Without this, transcription still works but summaries will be skipped.
            </p>
            <ol className="text-sm text-gray-400 mb-4 list-decimal list-inside space-y-2">
              <li>Go to <ExternalLink href="https://console.anthropic.com/settings/keys">Anthropic Console → API Keys</ExternalLink></li>
              <li>Click "Create Key"</li>
              <li>Copy the key below</li>
            </ol>
            <div>
              <label className="text-sm text-gray-400">API Key</label>
              <input
                type="password"
                value={claudeApiKey}
                onChange={(e) => { setClaudeApiKey(e.target.value); resetTest() }}
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
              />
            </div>

            <TestResult testing={testing} result={testResult} />

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => goNext('huggingface')}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Back
              </button>
              <button
                onClick={testClaude}
                disabled={!claudeApiKey || testing}
                className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 rounded font-medium"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={() => goNext('options')}
                disabled={!testResult?.ok}
                className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
              >
                Next
              </button>
            </div>
            <button
              onClick={() => goNext('options')}
              className="mt-2 w-full text-center text-sm text-gray-500 hover:text-gray-400"
            >
              Set up later
            </button>
          </div>
        )}

        {step === 'options' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Pipeline Options</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-sm text-gray-400">Audio file handling</label>
                <select
                  value={audioHandling}
                  onChange={(e) => setAudioHandling(e.target.value as any)}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 text-gray-200"
                >
                  <option value="store">Store in Maiscribe (keep original)</option>
                  <option value="store-and-delete">Store in Maiscribe (delete original)</option>
                  <option value="delete">Delete after processing</option>
                </select>
              </div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={autoWatch}
                  onChange={(e) => setAutoWatch(e.target.checked)}
                  className="accent-accent-500"
                />
                <span className="text-sm">Auto-watch inbox folder</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={autoSummarize}
                  onChange={(e) => setAutoSummarize(e.target.checked)}
                  className="accent-accent-500"
                />
                <span className="text-sm">Auto-summarize after transcription</span>
              </label>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => goNext('claude')}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Back
              </button>
              <button
                onClick={() => { finish(); setStep('done') }}
                className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 rounded font-medium"
              >
                Finish
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center">
            <h2 className="text-lg font-semibold mb-2">All set!</h2>
            <p className="text-sm text-gray-400">Your pipeline is configured and ready to use.</p>
            {syncingSecret && (
              <p className="text-sm text-gray-400 mt-3">Syncing Hugging Face token to Modal cloud...</p>
            )}
            {syncResult && !syncResult.ok && (
              <p className="text-sm text-red-400 mt-3">
                Failed to sync HF token to Modal: {syncResult.error}. You can fix this in Settings.
              </p>
            )}
            {syncResult?.ok && (
              <p className="text-sm text-green-400 mt-3">
                Hugging Face token synced to Modal cloud.
              </p>
            )}
            {(!modalTokenId || !hfToken) && (
              <p className="text-sm text-yellow-400 mt-3">
                Note: Transcription requires Modal and Hugging Face tokens. You can add them in Settings.
              </p>
            )}
            {!claudeApiKey && (
              <p className="text-sm text-yellow-400 mt-2">
                Summarization is disabled until you add a Claude API key in Settings.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      onClick={() => window.api.shell.openExternal(href)}
      className="text-accent-400 hover:text-accent-300 underline"
    >
      {children}
    </button>
  )
}

function TestResult({ testing, result }: { testing: boolean; result: { ok: boolean; error?: string } | null }) {
  if (testing) return <p className="mt-3 text-sm text-gray-400">Testing connection...</p>
  if (!result) return null
  if (result.ok) return <p className="mt-3 text-sm text-green-400">Connected successfully</p>
  return <p className="mt-3 text-sm text-red-400">{result.error || 'Connection failed'}</p>
}

function HfTestResult({ testing, result }: { testing: boolean; result: { ok: boolean; error?: string; models?: { model: string; ok: boolean; error?: string }[] } | null }) {
  if (testing) return <p className="mt-3 text-sm text-gray-400">Checking token and model access...</p>
  if (!result) return null
  if (!result.models || result.models.length === 0) {
    if (result.ok) return <p className="mt-3 text-sm text-green-400">Connected successfully</p>
    return <p className="mt-3 text-sm text-red-400">{result.error || 'Connection failed'}</p>
  }
  return (
    <div className="mt-3 space-y-1">
      <p className="text-sm text-gray-400">Model access:</p>
      {result.models.map(({ model, ok, error }) => (
        <div key={model} className="flex items-start gap-2 text-sm">
          <span className={ok ? 'text-green-400' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>
          <div>
            <span className={ok ? 'text-green-400' : 'text-red-400'}>{model.split('/')[1]}</span>
            {!ok && (
              <p className="text-xs text-red-400 mt-0.5">
                {error}{' '}
                <button
                  onClick={() => window.api.shell.openExternal(`https://huggingface.co/${model}`)}
                  className="text-accent-400 hover:text-accent-300 underline"
                >
                  Accept license →
                </button>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
