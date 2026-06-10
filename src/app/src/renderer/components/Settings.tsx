import { useState, useEffect } from 'react'
import type { AppConfig } from '../../shared/types'
import { useConfig } from '../hooks/useConfig'

type SettingsTab = 'keys' | 'defaults' | 'location' | 'setup'

interface SettingsProps {
  onOpenWizard?: () => void
}

export function Settings({ onOpenWizard }: SettingsProps) {
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
    }
    const hfToken = newEnv.HF_TOKEN || envKeys.HF_TOKEN
    const modalId = newEnv.MODAL_TOKEN_ID || envKeys.MODAL_TOKEN_ID
    const modalSecret = newEnv.MODAL_TOKEN_SECRET || envKeys.MODAL_TOKEN_SECRET
    if (hfToken && modalId && modalSecret) {
      setSyncing(true)
      const result = await window.api.validate.syncModalSecret(hfToken, modalId, modalSecret)
      setSyncStatus(result)
      setSyncing(false)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function selectFolder() {
    const path = await window.api.dialog.selectDirectory()
    if (path) setDraft({ ...draft!, basePath: path })
  }

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'defaults', label: 'Defaults' },
    { key: 'keys', label: 'API Keys' },
    { key: 'location', label: 'Location' },
    { key: 'setup', label: 'Setup' },
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-watch inbox folder with default settings</span>
              <span className="text-xs text-gray-500 cursor-help" title="Automatically start transcription when new audio files appear in your inbox folder, using the settings configured here">?</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.pipeline.autoWatch}
              onClick={() => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoWatch: !draft.pipeline.autoWatch } })}
              className={`relative w-10 h-5 rounded-full transition-colors ${draft.pipeline.autoWatch ? 'bg-accent-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${draft.pipeline.autoWatch ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="border-t border-gray-700 pt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Store audio in maiscribe</span>
              <span className="text-xs text-gray-500 cursor-help" title="Save a copy of the audio file alongside the transcription in maiscribe">?</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.pipeline.audioHandling === 'store' || draft.pipeline.audioHandling === 'store-and-delete'}
              onClick={() => {
                const storing = draft.pipeline.audioHandling === 'store' || draft.pipeline.audioHandling === 'store-and-delete'
                const deleting = draft.pipeline.audioHandling === 'delete' || draft.pipeline.audioHandling === 'store-and-delete'
                const newHandling = storing
                  ? (deleting ? 'delete' : 'delete')
                  : (deleting ? 'store-and-delete' : 'store')
                setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: newHandling } })
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${draft.pipeline.audioHandling === 'store' || draft.pipeline.audioHandling === 'store-and-delete' ? 'bg-accent-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${draft.pipeline.audioHandling === 'store' || draft.pipeline.audioHandling === 'store-and-delete' ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Delete original audio after processing</span>
              <span className="text-xs text-gray-500 cursor-help" title="Remove the original audio file from its source location after transcription completes">?</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.pipeline.audioHandling === 'store-and-delete' || draft.pipeline.audioHandling === 'delete'}
              onClick={() => {
                const deleting = draft.pipeline.audioHandling === 'store-and-delete' || draft.pipeline.audioHandling === 'delete'
                const storing = draft.pipeline.audioHandling === 'store' || draft.pipeline.audioHandling === 'store-and-delete'
                const newHandling = deleting
                  ? (storing ? 'store' : 'store')
                  : (storing ? 'store-and-delete' : 'delete')
                setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: newHandling } })
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${draft.pipeline.audioHandling === 'store-and-delete' || draft.pipeline.audioHandling === 'delete' ? 'bg-accent-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${draft.pipeline.audioHandling === 'store-and-delete' || draft.pipeline.audioHandling === 'delete' ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-summarize</span>
              <span className="text-xs text-gray-500 cursor-help" title="Generate a meeting summary with key points, action items, and participants after transcription completes">?</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.pipeline.autoSummarize}
              onClick={() => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoSummarize: !draft.pipeline.autoSummarize } })}
              className={`relative w-10 h-5 rounded-full transition-colors ${draft.pipeline.autoSummarize ? 'bg-accent-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${draft.pipeline.autoSummarize ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Minimum speakers</span>
              <span className="text-xs text-gray-500 cursor-help" title="Minimum number of speakers the diarizer should detect. Set to 2 for conversations, 1 for solo recordings.">?</span>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.pipeline.minSpeakers ?? 2}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, minSpeakers: parseInt(e.target.value) || 2 } })}
              className="w-16 bg-gray-700 rounded px-3 py-1.5 text-sm text-center"
            />
          </div>
        </section>
      )}

      {tab === 'location' && (
        <section>
          <p className="text-sm text-gray-400 mb-3">
            Where your maiscribe data is stored.
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

      {tab === 'setup' && (
        <section className="flex flex-col items-start gap-3">
          <p className="text-sm text-gray-400">
            Re-run the initial setup wizard to reconfigure your tokens and preferences.
          </p>
          <button
            onClick={onOpenWizard}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Open startup wizard
          </button>
        </section>
      )}

      {tab !== 'setup' && (
        <button
          onClick={handleSave}
          className="mt-auto py-2 bg-accent-500 hover:bg-accent-600 rounded font-medium"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      )}
    </div>
  )
}
