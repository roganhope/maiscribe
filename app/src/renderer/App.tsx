import { useState } from 'react'
import { useConfig } from './hooks/useConfig'
import { Dashboard } from './components/Dashboard'
import { SetupWizard } from './components/SetupWizard'
import { Settings } from './components/Settings'
import { HistoryView } from './components/HistoryView'

type Tab = 'process' | 'history'
type View = 'main' | 'settings'

export default function App() {
  const { config, saveConfig, loading } = useConfig()
  const [tab, setTab] = useState<Tab>('process')
  const [view, setView] = useState<View>('main')
  const [wizardDone, setWizardDone] = useState(false)

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

  if (view === 'settings') {
    return <Settings onBack={() => setView('main')} />
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center border-b border-gray-700 px-6 pt-8 drag-region">
        <nav className="flex gap-6 no-drag">
          <button
            onClick={() => setTab('process')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'process'
                ? 'border-accent-400 text-accent-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Process
          </button>
          <button
            onClick={() => setTab('history')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'history'
                ? 'border-accent-400 text-accent-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            History
          </button>
        </nav>
        <div className="flex-1" />
        <button
          onClick={() => setView('settings')}
          className="text-xs text-gray-500 hover:text-gray-300 no-drag pb-2"
        >
          Settings
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'process' && <Dashboard />}
        {tab === 'history' && <HistoryView />}
      </div>
    </div>
  )
}
