import { useState, type DragEvent } from 'react'
import { StaffView } from './notation/StaffView'
import { useAppStore } from './store/appStore'
import { ExportDialog } from './ui/ExportDialog'
import { MixerPanel } from './ui/MixerPanel'
import { PracticeHeader } from './ui/PracticeHeader'
import { SplitPanes } from './ui/SplitPanes'
import { TopBar } from './ui/TopBar'
import { useMidiLoader } from './ui/useMidiLoader'

/** Default heights of the controls, staff and mixer panes, as fractions. */
const DEFAULT_PANE_SIZES = [0.2, 0.42, 0.38]

export default function App(): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const selectedTrack = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? s.song.tracks[s.selectedTrackId] : null
  )
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
      <SplitPanes
        defaultSizes={DEFAULT_PANE_SIZES}
        storageKey="pane-sizes"
        labels={['controls', 'staff', 'mixer']}
      >
        <TopBar onOpen={() => void openDialog()} />

        <main className="staff-pane">
          {song ? (
            <>
              <PracticeHeader />
              {selectedTrack &&
                (selectedTrack.isDrum ? (
                  <p className="placeholder">Drum tracks are not shown on a staff.</p>
                ) : (
                  <StaffView song={song} track={selectedTrack} />
                ))}
            </>
          ) : (
            <p className="placeholder staff-pane__empty">Open a MIDI file or drop one here.</p>
          )}
        </main>

        <MixerPanel />
      </SplitPanes>

      <ExportDialog />
    </div>
  )
}
