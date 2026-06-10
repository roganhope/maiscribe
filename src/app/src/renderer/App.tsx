import { useState, useRef } from 'react'
import { useConfig } from './hooks/useConfig'
import { usePythonEnv } from './hooks/usePythonEnv'
import { Dashboard } from './components/Dashboard'
import { SetupWizard } from './components/SetupWizard'
import { Settings } from './components/Settings'
import { HistoryView, HistoryViewHandle } from './components/HistoryView'
import { SpeakersTab } from './components/SpeakersTab'

type Tab = 'process' | 'history' | 'speakers' | 'settings'

export default function App() {
  const { config, saveConfig, loading } = useConfig()
  const pythonEnv = usePythonEnv()
  const [tab, setTab] = useState<Tab>('process')
  const [wizardDone, setWizardDone] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const historyRef = useRef<HistoryViewHandle>(null)

  function handleOpenHistory(outputPath: string) {
    setTab('history')
    setTimeout(() => {
      historyRef.current?.selectByPath(outputPath)
    }, 100)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen flex-col gap-4">
        <img src="./assets/icon.png" alt="" className="w-16 h-16 rounded-xl" />
        <span className="text-gray-500 text-sm">Loading...</span>
      </div>
    )
  }

  if ((!config && !wizardDone) || showWizard) {
    return (
      <SetupWizard
        onComplete={(newConfig) => {
          saveConfig(newConfig)
          setWizardDone(true)
          setShowWizard(false)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center border-b border-gray-700 px-6 pt-8 drag-region">
        <nav className="flex gap-6 no-drag">
          {(['process', 'history', 'speakers'] as Tab[]).map(t => (
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

      {pythonEnv.state !== 'ready' && pythonEnv.state !== 'idle' && (
        <div className={`px-6 py-2 text-sm ${pythonEnv.state === 'error' ? 'bg-red-900/50 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
          {pythonEnv.state === 'error' ? `Setup error: ${pythonEnv.message}` : pythonEnv.message}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {tab === 'process' && <Dashboard onOpenHistory={handleOpenHistory} onNavigateToKeys={() => setTab('settings')} />}
        {tab === 'history' && <HistoryView ref={historyRef} />}
        {tab === 'speakers' && <SpeakersTab />}
        {tab === 'settings' && <Settings onOpenWizard={() => setShowWizard(true)} />}
      </div>
    </div>
  )
}
