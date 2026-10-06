import { useState, type DragEvent } from 'react'
import { useAppStore } from './store/appStore'
import { useMidiLoader } from './ui/useMidiLoader'

export default function App(): React.JSX.Element {
  const file = useAppStore((s) => s.file)
  const error = useAppStore((s) => s.error)
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
        <span className="toolbar__file">{file ? file.name : 'No file loaded'}</span>
      </header>

      <main className="content">
        {error && <div className="error">{error}</div>}
        {!file && <p className="placeholder">Open a MIDI file or drop one here.</p>}
        {file && (
          <p className="placeholder">
            Loaded {file.name} ({file.data.byteLength.toLocaleString()} bytes)
          </p>
        )}
      </main>
    </div>
  )
}
