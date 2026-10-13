import type { UpdateStatus } from '../shared/api'

/** Where releases are published; update links must point here. */
export const RELEASES_PAGE = 'https://github.com/Florian-Heringa/buzzz-midi-player/releases'
/** GitHub API for the newest published release (drafts and pre-releases are left out). */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/Florian-Heringa/buzzz-midi-player/releases/latest'

/** "v1.2.3" or "1.2.3" (anything after the patch number ignored) as numbers; null if not a version. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Whether `candidate` is a later version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/**
 * Asks GitHub for the latest release and compares it with the running version.
 * `fetchUrl` does the request (Electron's net.fetch in the app, a stub in tests).
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchUrl: (url: string) => Promise<Response>,
  url = LATEST_RELEASE_API
): Promise<UpdateStatus> {
  let response: Response
  try {
    response = await fetchUrl(url)
  } catch (err) {
    return { status: 'failed', message: `GitHub could not be reached (${errorText(err)}).` }
  }
  // No release published yet.
  if (response.status === 404) return { status: 'current', version: currentVersion }
  if (!response.ok) return { status: 'failed', message: `GitHub answered with an error (${response.status}).` }

  let release: unknown
  try {
    release = await response.json()
  } catch {
    return { status: 'failed', message: 'GitHub sent an unreadable answer.' }
  }
  const tag = isRecord(release) && typeof release.tag_name === 'string' ? release.tag_name : null
  const version = tag ? parseVersion(tag) : null
  if (!tag || !version) return { status: 'failed', message: 'The latest release has no version number.' }
  if (!isNewer(tag, currentVersion)) return { status: 'current', version: currentVersion }

  // Only ever link to this project's releases.
  const page = isRecord(release) && typeof release.html_url === 'string' ? release.html_url : ''
  return {
    status: 'available',
    version: version.join('.'),
    url: page.startsWith(`${RELEASES_PAGE}/`) ? page : `${RELEASES_PAGE}/tag/${encodeURIComponent(tag)}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
