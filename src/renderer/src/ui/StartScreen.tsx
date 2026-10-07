import { useEffect, useState } from 'react'
import type { RecentFile } from '@shared/api'

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "today", "yesterday", "3 days ago", "2 months ago". */
function openedAgo(openedAt: number, now = Date.now()): string {
  const days = Math.round((openedAt - now) / 86_400_000)
  if (days > -1) return 'today'
  if (days > -30) return relativeTime.format(days, 'day')
  if (days > -365) return relativeTime.format(Math.round(days / 30), 'month')
  return relativeTime.format(Math.round(days / 365), 'year')
}

/** Shown while no file is open: open a file, or pick up a recently opened one. */
export function StartScreen({
  onOpen,
  onOpenRecent
}: {
  onOpen: () => void
  onOpenRecent: (path: string) => void
}): React.JSX.Element {
  const [files, setFiles] = useState<RecentFile[]>([])

  useEffect(() => {
    let active = true
    void window.api.getRecentFiles().then((list) => active && setFiles(list))
    const unsubscribe = window.api.onRecentFilesChanged(setFiles)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="start-screen">
      <div className="start-screen__open">
        <button className="button--primary" onClick={onOpen}>
          Open MIDI…
        </button>
        <span className="placeholder">or drop a MIDI file anywhere in the window</span>
      </div>

      {files.length > 0 && (
        <section className="start-screen__recent" aria-labelledby="recent-files-title">
          <div className="start-screen__recent-header">
            <h2 id="recent-files-title">Recent files</h2>
            <button className="start-screen__clear" onClick={() => void window.api.clearRecentFiles()}>
              Clear list
            </button>
          </div>
          <ul>
            {files.map((file) => (
              <li key={file.path} className={file.exists ? undefined : 'start-screen__missing'}>
                <button
                  className="start-screen__file"
                  onClick={() => onOpenRecent(file.path)}
                  disabled={!file.exists}
                  title={file.exists ? file.path : `${file.path} (not found)`}
                >
                  <span className="start-screen__name">{file.name}</span>
                  <span className="start-screen__folder">{file.folder}</span>
                  <span className="start-screen__when">
                    {file.exists ? openedAgo(file.openedAt) : 'not found'}
                  </span>
                </button>
                <button
                  className="start-screen__remove"
                  onClick={() => void window.api.removeRecentFile(file.path)}
                  aria-label={`Remove ${file.name} from recent files`}
                  title="Remove from recent files"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
