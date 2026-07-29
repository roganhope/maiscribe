import { useState, useEffect } from 'react'
import type { ProvisionStatus } from '../../shared/types'

export function useProvision(): ProvisionStatus {
  const [status, setStatus] = useState<ProvisionStatus>({
    state: 'idle',
    message: '',
    index: 0,
    total: 0,
  })

  useEffect(() => {
    window.api.provision.getStatus().then(setStatus)
    const unsub = window.api.provision.onStatus(setStatus)
    return unsub
  }, [])

  return status
}
