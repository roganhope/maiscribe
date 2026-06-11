import { useState, useEffect } from 'react'
import type { QueueState } from '../../shared/types'

export function useQueue(): QueueState {
  const [state, setState] = useState<QueueState>([])

  useEffect(() => {
    let pushed = false
    const unsubscribe = window.api.queue.onState((newState) => {
      pushed = true
      setState(newState)
    })
    // Seed with current state on mount; a push arriving first is newer, so it wins
    window.api.queue.getState().then((initial) => {
      if (!pushed) setState(initial)
    })
    return unsubscribe
  }, [])

  return state
}
