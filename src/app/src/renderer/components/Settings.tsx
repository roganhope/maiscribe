import { useState, useEffect } from 'react'
import type { AppConfig } from '../../shared/types'
import { useConfig } from '../hooks/useConfig'

type SettingsTab = 'keys' | 'defaults' | 'location'

export function Settings() {
  const { config, saveConfig } = useConfig()
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [envKeys, setEnvKeys] = useState<Record<string, string>>({})
  const [newEnv, setNewEnv] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<SettingsTab>('defaults')
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    if (config) setDraft({ ...config })
    window.api.env.get().then(setEnvKeys)
  }, [config])

  if (!draft) return null

  async function handleSave() {
    if (!draft) return
    await saveConfig(draft)
    if (Object.values(newEnv).some(Boolean)) {
      await window.api.env.set(newEnv)
      if (newEnv.HF_TOKEN) {
        const modalId = newEnv.MODAL_TOKEN_ID || envKeys.MODAL_TOKEN_ID
        const modalSecret = newEnv.MODAL_TOKEN_SECRET || envKeys.MODAL_TOKEN_SECRET
        if (modalId && modalSecret) {
          setSyncing(true)
          const result = await window.api.validate.syncModalSecret(newEnv.HF_TOKEN, modalId, modalSecret)
          setSyncStatus(result)
          setSyncing(false)
        }
      }
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSyncSecret() {
    setSyncing(true)
    setSyncStatus(null)
    const result = await window.api.validate.syncModalSecretFromEnv()
    setSyncStatus(result)
    setSyncing(false)
  }

  async function selectFolder() {
    const path = await window.api.dialog.selectDirectory()
    if (path) setDraft({ ...draft!, basePath: path })
  }

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'defaults', label: 'Defaults' },
    { key: 'keys', label: 'API Keys' },
    { key: 'location', label: 'Location' },
  ]

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="flex gap-4 border-b border-gray-700 pb-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-accent-400 text-accent-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'keys' && (
        <section className="flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Modal</h3>
            <div className="flex flex-col gap-3">
              {['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'].map(key => (
                <div key={key}>
                  <label className="text-sm text-gray-400">{key}</label>
                  <input
                    type="password"
                    placeholder={envKeys[key] ? '(set) enter new value to change' : 'Not set'}
                    value={newEnv[key] || ''}
                    onChange={(e) => setNewEnv({ ...newEnv, [key]: e.target.value })}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 placeholder-gray-500"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Hugging Face</h3>
            <div className="flex flex-col gap-3">
              {['HF_TOKEN'].map(key => (
                <div key={key}>
                  <label className="text-sm text-gray-400">{key}</label>
                  <input
                    type="password"
                    placeholder={envKeys[key] ? '(set) enter new value to change' : 'Not set'}
                    value={newEnv[key] || ''}
                    onChange={(e) => setNewEnv({ ...newEnv, [key]: e.target.value })}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 placeholder-gray-500"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={handleSyncSecret}
              disabled={syncing}
              className="mt-3 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs text-gray-300"
            >
              {syncing ? 'Syncing...' : 'Sync HF token to Modal cloud'}
            </button>
            {syncStatus && (
              <p className={`mt-2 text-xs ${syncStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
                {syncStatus.ok ? 'Synced to Modal' : syncStatus.error}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Claude</h3>
            <div className="flex flex-col gap-3">
              {['CLAUDE_API_KEY'].map(key => (
                <div key={key}>
                  <label className="text-sm text-gray-400">{key}</label>
                  <input
                    type="password"
                    placeholder={envKeys[key] ? '(set) enter new value to change' : 'Not set'}
                    value={newEnv[key] || ''}
                    onChange={(e) => setNewEnv({ ...newEnv, [key]: e.target.value })}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 placeholder-gray-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'defaults' && (
        <section className="flex flex-col gap-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.audioHandling !== 'delete'}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: e.target.checked ? (draft.pipeline.audioHandling === 'delete' ? 'store' : draft.pipeline.audioHandling) : 'delete' } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Store audio file with transcription</span>
            <span className="text-xs text-gray-500 cursor-help" title="Save a copy of the audio file alongside the transcription in your outbox">?</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.audioHandling === 'store-and-delete'}
              disabled={draft.pipeline.audioHandling === 'delete'}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: e.target.checked ? 'store-and-delete' : 'store' } })}
              className="accent-accent-500"
            />
            <span className={`text-sm ${draft.pipeline.audioHandling === 'delete' ? 'text-gray-600' : ''}`}>Delete original after storing</span>
            <span className="text-xs text-gray-500 cursor-help" title="Remove the original audio file from its source location after copying it to the outbox">?</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.autoWatch}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoWatch: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-watch inbox folder with default settings</span>
            <span className="text-xs text-gray-500 cursor-help" title="Automatically start transcription when new audio files appear in your inbox folder, using the settings configured here">?</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.autoSummarize}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoSummarize: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-summarize</span>
            <span className="text-xs text-gray-500 cursor-help" title="Generate a meeting summary with key points, action items, and participants after transcription completes">?</span>
          </label>
        </section>
      )}

      {tab === 'location' && (
        <section>
          <p className="text-sm text-gray-400 mb-3">
            Where your inbox and outbox folders are stored.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft.basePath}
              onChange={(e) => setDraft({ ...draft, basePath: e.target.value })}
              className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm"
            />
            <button onClick={selectFolder} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Change
            </button>
          </div>
        </section>
      )}

      <button
        onClick={handleSave}
        className="mt-auto py-2 bg-accent-500 hover:bg-accent-600 rounded font-medium"
      >
        {saved ? 'Saved!' : 'Save'}
      </button>
    </div>
  )
}
