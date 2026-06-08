import { useState } from 'react'
import type { AppConfig } from '../../shared/types'

type Step = 'folder' | 'keys' | 'options' | 'done'

interface Props {
  onComplete: (config: AppConfig) => void
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('folder')
  const [basePath, setBasePath] = useState('')
  const [pythonPath, setPythonPath] = useState('python3')
  const [modalTokenId, setModalTokenId] = useState('')
  const [modalTokenSecret, setModalTokenSecret] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [audioHandling, setAudioHandling] = useState<'store' | 'store-and-delete' | 'delete'>('store')
  const [autoWatch, setAutoWatch] = useState(true)
  const [autoSummarize, setAutoSummarize] = useState(true)

  async function selectFolder() {
    const path = await window.api.dialog.selectDirectory()
    if (path) setBasePath(path)
  }

  async function finish() {
    const config: AppConfig = {
      version: 1,
      basePath,
      pythonPath,
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
    await window.api.env.set({
      MODAL_TOKEN_ID: modalTokenId,
      MODAL_TOKEN_SECRET: modalTokenSecret,
      CLAUDE_API_KEY: claudeApiKey,
    })

    onComplete(config)
  }

  return (
    <div className="fixed inset-0 bg-gray-900/95 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
        <div className="flex gap-2 mb-8">
          {(['folder', 'keys', 'options', 'done'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded ${
                i <= ['folder', 'keys', 'options', 'done'].indexOf(step)
                  ? 'bg-accent-400'
                  : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {step === 'folder' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Project Folder</h2>
            <p className="text-sm text-gray-400 mb-4">
              Select the folder where your inbox and outbox live.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                placeholder="/path/to/audio-transcription"
                className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
              />
              <button
                onClick={selectFolder}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Browse
              </button>
            </div>
            <div className="mt-4">
              <label className="text-sm text-gray-400">Python path</label>
              <input
                type="text"
                value={pythonPath}
                onChange={(e) => setPythonPath(e.target.value)}
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
              />
            </div>
            <button
              onClick={() => setStep('keys')}
              disabled={!basePath}
              className="mt-6 w-full py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
            >
              Next
            </button>
          </div>
        )}

        {step === 'keys' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">API Keys</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-sm text-gray-400">Modal Token ID</label>
                <input
                  type="password"
                  value={modalTokenId}
                  onChange={(e) => setModalTokenId(e.target.value)}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Modal Token Secret</label>
                <input
                  type="password"
                  value={modalTokenSecret}
                  onChange={(e) => setModalTokenSecret(e.target.value)}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Claude API Key</label>
                <input
                  type="password"
                  value={claudeApiKey}
                  onChange={(e) => setClaudeApiKey(e.target.value)}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-gray-200 mt-1"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setStep('folder')}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Back
              </button>
              <button
                onClick={() => setStep('options')}
                disabled={!modalTokenId || !modalTokenSecret}
                className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-40 rounded font-medium"
              >
                Next
              </button>
            </div>
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
                  <option value="store">Store in outbox (keep original)</option>
                  <option value="store-and-delete">Store in outbox (delete original)</option>
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
                onClick={() => setStep('keys')}
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
          </div>
        )}
      </div>
    </div>
  )
}
