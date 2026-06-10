import { useState, useEffect } from 'react'
import type { AppConfig } from '../../shared/types'

export function useConfig() {
  const [config, setConfigState] = useState<AppConfig | null | undefined>(undefined)

  useEffect(() => {
    window.api.config.get().then(setConfigState)
  }, [])

  const saveConfig = async (newConfig: AppConfig) => {
    await window.api.config.set(newConfig)
    setConfigState(newConfig)
  }

  return { config, saveConfig, loading: config === undefined }
}
