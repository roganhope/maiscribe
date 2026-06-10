import { useState, useEffect } from 'react'
import type { QueueState } from '../../shared/types'

export function useQueue(): QueueState {
  const [state, setState] = useState<QueueState>([])

  useEffect(() => {
    const unsubscribe = window.api.queue.onState((newState) => {
      setState(newState)
    })
    return unsubscribe
  }, [])

  return state
}
