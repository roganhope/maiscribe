import { useState, useRef } from 'react'
import { useConfig } from './hooks/useConfig'
import { Dashboard } from './components/Dashboard'
import { SetupWizard } from './components/SetupWizard'
import { Settings } from './components/Settings'
import { HistoryView, HistoryViewHandle } from './components/HistoryView'

type Tab = 'process' | 'history' | 'settings'

export default function App() {
  const { config, saveConfig, loading } = useConfig()
  const [tab, setTab] = useState<Tab>('process')
  const [wizardDone, setWizardDone] = useState(false)
  const historyRef = useRef<HistoryViewHandle>(null)

  function handleOpenHistory(outputPath: string) {
    setTab('history')
    setTimeout(() => {
      historyRef.current?.selectByPath(outputPath)
    }, 100)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Loading...
      </div>
    )
  }

  if (!config && !wizardDone) {
    return (
      <SetupWizard
        onComplete={(newConfig) => {
          saveConfig(newConfig)
          setWizardDone(true)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center border-b border-gray-700 px-6 pt-8 drag-region">
        <nav className="flex gap-6 no-drag">
          {(['process', 'history'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? 'border-accent-400 text-accent-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          onClick={() => setTab('settings')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors no-drag ${
            tab === 'settings'
              ? 'border-accent-400 text-accent-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Settings
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'process' && <Dashboard onOpenHistory={handleOpenHistory} />}
        {tab === 'history' && <HistoryView ref={historyRef} />}
        {tab === 'settings' && <Settings />}
      </div>
    </div>
  )
}
