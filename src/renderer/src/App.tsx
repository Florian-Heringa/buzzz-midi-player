import { useState, type DragEvent } from 'react'
import { SheetView } from './notation/sheet/SheetView'
import { StaffView } from './notation/StaffView'
import { interpretedSong, useAppStore } from './store/appStore'
import { ExportDialog } from './ui/ExportDialog'
import { MixerPanel } from './ui/MixerPanel'
import { PracticeHeader } from './ui/PracticeHeader'
import { SettingsDialog } from './ui/SettingsDialog'
import { useSettings } from './ui/settings'
import { SplitPanes } from './ui/SplitPanes'
import { StartScreen } from './ui/StartScreen'
import { trackHueStyle } from './ui/theme'
import { Toasts } from './ui/Toasts'
import { TopBar } from './ui/TopBar'
import { useMidiLoader } from './ui/useMidiLoader'

export default function App(): React.JSX.Element {
  const song = useAppStore((s) => s.song)
  const selectedTrack = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? s.song.tracks[s.selectedTrackId] : null
  )
  const { noteDisplay } = useSettings()
  // The song as the user reads its key (sharps or flats, major or minor).
  const keyedSong = useAppStore(interpretedSong)
  const { openDialog, openRecent, loadDroppedFile } = useMidiLoader()
  const openSettings = useAppStore((s) => s.openSettings)
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
      {song ? (
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
            <PracticeHeader />
            {selectedTrack &&
              (selectedTrack.isDrum ? (
                <p className="placeholder">Drum tracks are not shown on a staff.</p>
              ) : noteDisplay === 'piano-roll' ? (
                <StaffView song={keyedSong ?? song} track={selectedTrack} />
              ) : (
                <SheetView song={keyedSong ?? song} track={selectedTrack} />
              ))}
          </main>

          <MixerPanel />
        </SplitPanes>
      ) : (
        // No file yet: one pane with opening a file, recent files and settings.
        <main className="start-page">
          <StartScreen onOpen={() => void openDialog()} onOpenRecent={(path) => void openRecent(path)} />
          <button className="settings-button start-page__settings" onClick={openSettings} aria-haspopup="dialog">
            <span aria-hidden>⚙</span> Settings
          </button>
        </main>
      )}

      <ExportDialog />
      <SettingsDialog />
      <Toasts />
    </div>
  )
}
