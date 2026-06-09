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
        <section>
          <div className="flex flex-col gap-3">
            {['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'HF_TOKEN', 'CLAUDE_API_KEY'].map(key => (
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
        </section>
      )}

      {tab === 'defaults' && (
        <section className="flex flex-col gap-4">
          <div>
            <label className="text-sm text-gray-400">Audio file handling</label>
            <select
              value={draft.pipeline.audioHandling}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: e.target.value as any } })}
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
              checked={draft.pipeline.autoWatch}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoWatch: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-watch inbox folder</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.autoSummarize}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoSummarize: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-summarize</span>
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
