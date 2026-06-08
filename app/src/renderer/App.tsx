import { useState } from 'react'
import { useConfig } from './hooks/useConfig'
import { Dashboard } from './components/Dashboard'
import { SetupWizard } from './components/SetupWizard'
import { Settings } from './components/Settings'

type View = 'dashboard' | 'settings'

export default function App() {
  const { config, saveConfig, loading } = useConfig()
  const [view, setView] = useState<View>('dashboard')
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
    return <Settings onBack={() => setView('dashboard')} />
  }

  return (
    <div className="flex flex-col h-screen">
      <Dashboard />
      <div className="px-6 pb-4">
        <button
          onClick={() => setView('settings')}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Settings
        </button>
      </div>
    </div>
  )
}
