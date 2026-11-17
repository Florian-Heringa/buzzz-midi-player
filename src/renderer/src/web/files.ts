// File access for the web version: the browser's file picker and downloads instead of native
// dialogs.

/** Shows the browser's file picker. Resolves to null when cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Offers bytes as a download; the browser decides where it goes (usually Downloads). */
export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has started by now; give the browser a moment before releasing the data.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** SHA-1 of the bytes as hex, the same as the desktop app's hash (so presets match). */
export async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
