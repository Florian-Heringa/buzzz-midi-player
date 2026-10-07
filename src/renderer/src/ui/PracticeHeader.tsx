import { trackDisplayName, useAppStore } from '../store/appStore'

/** Title of the practice track plus one-click solo / mute for it. */
export function PracticeHeader(): React.JSX.Element | null {
  const track = useAppStore((s) =>
    s.song && s.selectedTrackId !== null ? s.song.tracks[s.selectedTrackId] : null
  )
  const mix = useAppStore((s) => (s.selectedTrackId !== null ? s.mixes[s.selectedTrackId] : null))
  const updateMix = useAppStore((s) => s.updateMix)
  const name = useAppStore((s) => trackDisplayName(s, s.selectedTrackId))
  if (!track || !mix) return null

  return (
    <div className="practice-header">
      <h2 className="practice-header__title">
        <span className="practice-header__swatch" aria-hidden />
        {name}
      </h2>
      <button
        aria-pressed={mix.solo}
        className={mix.solo ? 'button--active' : ''}
        onClick={() => updateMix(track.id, { solo: !mix.solo, muted: false })}
        title="Hear only this part (other soloed parts stay audible)"
      >
        Solo part
      </button>
      <button
        aria-pressed={mix.muted}
        className={mix.muted ? 'button--active' : ''}
        onClick={() => updateMix(track.id, { muted: !mix.muted, solo: false })}
        title="Sing this part yourself with the other parts playing"
      >
        Mute part
      </button>
    </div>
  )
}
