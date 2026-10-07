import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname } from 'path'
import type { RecentFile } from '../shared/api'

/** How many recently opened files are remembered. */
export const MAX_RECENT_FILES = 10

export interface RecentEntry {
  path: string
  /** When the file was last opened (ms since epoch). */
  openedAt: number
}

/** Windows paths are case-insensitive, so compare them that way. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** The list with `path` moved (or added) to the top, keeping at most MAX_RECENT_FILES. */
export function withRecent(list: readonly RecentEntry[], path: string, now: number): RecentEntry[] {
  return [{ path, openedAt: now }, ...list.filter((entry) => !samePath(entry.path, path))].slice(
    0,
    MAX_RECENT_FILES
  )
}

export function withoutRecent(list: readonly RecentEntry[], path: string): RecentEntry[] {
  return list.filter((entry) => !samePath(entry.path, path))
}

export function isRecent(list: readonly RecentEntry[], path: string): boolean {
  return list.some((entry) => samePath(entry.path, path))
}

/** Validates the saved list (untrusted JSON). */
export function parseRecent(json: unknown): RecentEntry[] {
  if (!Array.isArray(json)) return []
  return json
    .filter(
      (e): e is RecentEntry =>
        typeof e === 'object' && e !== null && typeof e.path === 'string' && typeof e.openedAt === 'number'
    )
    .slice(0, MAX_RECENT_FILES)
}

/** What the window shows: name, folder and whether the file is still there. */
export function describeRecent(list: readonly RecentEntry[]): RecentFile[] {
  return list.map((entry) => ({
    path: entry.path,
    name: basename(entry.path),
    folder: dirname(entry.path),
    openedAt: entry.openedAt,
    exists: existsSync(entry.path)
  }))
}

/** Reads and writes the list in the user data folder. */
export class RecentFilesStore {
  private list: RecentEntry[] = []

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.list = parseRecent(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.list = [] // none saved yet, or unreadable
    }
  }

  get entries(): readonly RecentEntry[] {
    return this.list
  }

  async add(path: string): Promise<void> {
    await this.save(withRecent(this.list, path, Date.now()))
  }

  async remove(path: string): Promise<void> {
    await this.save(withoutRecent(this.list, path))
  }

  async clear(): Promise<void> {
    await this.save([])
  }

  has(path: string): boolean {
    return isRecent(this.list, path)
  }

  private async save(list: RecentEntry[]): Promise<void> {
    this.list = list
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(list, null, 2))
  }
}
