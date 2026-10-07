/** Minutes and seconds, e.g. 75 → "1:15". */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Pan as L/C/R percentage, e.g. -32 → "L50". */
export function panLabel(pan: number): string {
  if (pan === 0) return 'C'
  return pan < 0 ? `L${Math.round((-pan / 64) * 100)}` : `R${Math.round((pan / 63) * 100)}`
}
