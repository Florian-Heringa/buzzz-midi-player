import { useState, type DragEvent } from 'react'
import { StaffView } from './notation/StaffView'
import { useAppStore } from './store/appStore'
import { ExportDialog } from './ui/ExportDialog'
import { PracticeHeader } from './ui/PracticeHeader'
import { SongInfo } from './ui/SongInfo'
import { TrackList } from './ui/TrackList'
import { TransportBar } from './ui/TransportBar'
import { useMidiLoader } from './ui/useMidiLoader'

export default function App(): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const selectedTrack = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? s.song.tracks[s.selectedTrackId] : null
  )
  const error = useAppStore((s) => s.error)
  const notice = useAppStore((s) => s.notice)
  const openExportDialog = useAppStore((s) => s.openExportDialog)
  const { openDialog, loadDroppedFile } = useMidiLoader()
  const [dragging, setDragging] = useState(false)

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) void loadDroppedFile(dropped)
  }

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <button onClick={() => void openDialog()}>Open MIDI…</button>
        <button onClick={openExportDialog} disabled={!song}>
          Export MP3…
        </button>
        <span className="toolbar__file">{song ? song.name : 'No file loaded'}</span>
        {notice && (
          <span className="toolbar__notice" role="status">
            {notice}
          </span>
        )}
      </header>

      <TransportBar />

      {error && <div className="error">{error}</div>}

      {song ? (
        <div className="workspace">
          <aside className="sidebar">
            <SongInfo />
            <TrackList />
          </aside>
          <main className="content">
            <PracticeHeader />
            {selectedTrack &&
              (selectedTrack.isDrum ? (
                <p className="placeholder">Drum tracks are not shown on a staff.</p>
              ) : (
                <StaffView song={song} track={selectedTrack} />
              ))}
          </main>
        </div>
      ) : (
        <main className="content content--empty">
          <p className="placeholder">Open a MIDI file or drop one here.</p>
        </main>
      )}

      <ExportDialog />
    </div>
  )
}
