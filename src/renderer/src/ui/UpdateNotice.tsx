import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/api'

/**
 * "Update available" while GitHub has a newer release than this app (checked at startup and
 * from Help > Check for Updates…). Clicking it opens the release page to download it.
 * `compact` keeps it short where space is tight (the top bar).
 */
export function UpdateNotice({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let active = true
    // The startup check may finish before this subscribes, so ask for its result too.
    void window.api.getAvailableUpdate().then((found) => active && setUpdate(found))
    const unsubscribe = window.api.onAvailableUpdate((found) => {
      active = false // a newer answer than the one asked for above
      setUpdate(found)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (update?.status !== 'available') return null
  return (
    <button
      className="button--primary update-notice"
      onClick={() => void window.api.openReleasePage(update.url)}
      title={`Update available: download Buzzz Midi Player ${update.version} from GitHub`}
    >
      <span aria-hidden>⬆</span> {compact ? 'Update' : 'Update available:'} {update.version}
    </button>
  )
}
