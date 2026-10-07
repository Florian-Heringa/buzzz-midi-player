import { useState, type DragEvent } from 'react'
import { StaffView } from './notation/StaffView'
import { useAppStore } from './store/appStore'
import { ExportDialog } from './ui/ExportDialog'
import { MixerPanel } from './ui/MixerPanel'
import { PracticeHeader } from './ui/PracticeHeader'
import { SplitPanes } from './ui/SplitPanes'
import { trackHueStyle } from './ui/theme'
import { TopBar } from './ui/TopBar'
import { useMidiLoader } from './ui/useMidiLoader'

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
        // Controls and staff fit their content; the mixer takes the rest. Controls and mixer
        // never get smaller than their content, so no text is cut off.
        fillPane={2}
        minSizes={['content', 80, 'content']}
        storageKey="pane-layout"
        labels={['controls', 'staff', 'mixer']}
      >
        <TopBar onOpen={() => void openDialog()} />

        <main className="staff-pane" style={selectedTrack ? trackHueStyle(selectedTrack.id) : undefined}>
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
