import { useState, useEffect } from 'react'
import type { PythonEnvStatus } from '../../shared/types'

export function usePythonEnv() {
  const [status, setStatus] = useState<PythonEnvStatus>({ state: 'idle', message: '' })

  useEffect(() => {
    window.api.pythonEnv.getStatus().then(setStatus)
    const unsub = window.api.pythonEnv.onStatus(setStatus)
    return unsub
  }, [])

  return status
}
