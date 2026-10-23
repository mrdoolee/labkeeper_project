import { useRef, useState } from 'react'
import { errorText } from './Field'

/**
 * Runs one save at a time: a second click while a save is running is ignored
 * (GAS takes seconds per request). Errors go to setError.
 */
export function useBusy(setError: (message: string | null) => void) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return { busy, run }
}
