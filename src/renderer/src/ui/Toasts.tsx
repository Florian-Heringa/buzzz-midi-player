import { useAppStore } from '../store/appStore'

/**
 * Notices and errors float over the window instead of taking space in the layout, so
 * showing or hiding one never moves the rest of the UI.
 */
export function Toasts(): React.JSX.Element {
  const notice = useAppStore((s) => s.notice)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)

  return (
    <div className="toasts">
      {/* Live regions stay mounted so screen readers announce new messages. */}
      <div role="status" aria-live="polite">
        {notice && <div className="toast toast--notice">{notice}</div>}
      </div>
      <div role="alert" aria-live="assertive">
        {error && (
          <div className="toast toast--error">
            <span className="error">{error}</span>
            <button className="toast__dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
