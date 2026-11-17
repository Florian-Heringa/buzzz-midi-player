// Recently opened files for the web version. A web page cannot open a file again by its path,
// so a copy of each file is kept in IndexedDB (MIDI files are small), keyed by content hash.
import type { LoadedMidiFile, RecentFile } from '@shared/api'

/** How many recently opened files are remembered (as in the desktop app). */
const MAX_RECENT_FILES = 10

const DB_NAME = 'buzzz-midi-player'
const STORE = 'recent-files'

interface StoredFile {
  hash: string
  name: string
  data: Uint8Array
  openedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'hash' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    dbPromise.catch(() => (dbPromise = null))
  }
  return dbPromise
}

/** Runs one request in a transaction and resolves when the transaction is done. */
async function run<T>(
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const tx = (await openDb()).transaction(STORE, mode)
  const request = makeRequest(tx.objectStore(STORE))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error)
  })
}

/** Stored files, newest first. */
async function storedFiles(): Promise<StoredFile[]> {
  const all = await run('readonly', (store) => store.getAll() as IDBRequest<StoredFile[]>)
  return all.sort((a, b) => b.openedAt - a.openedAt)
}

/** In the web version the "path" of a recent file is its hash: it identifies the stored copy. */
export async function getRecentFiles(): Promise<RecentFile[]> {
  return (await storedFiles()).map((file) => ({
    path: file.hash,
    name: file.name,
    folder: '',
    openedAt: file.openedAt,
    exists: true
  }))
}

/** Moves the file (or adds it) to the top of the list, keeping at most MAX_RECENT_FILES. */
export async function addRecentFile(file: LoadedMidiFile): Promise<void> {
  const stored: StoredFile = {
    hash: file.hash,
    name: file.name,
    data: file.data,
    openedAt: Date.now()
  }
  await run('readwrite', (store) => store.put(stored))
  const extra = (await storedFiles()).slice(MAX_RECENT_FILES)
  for (const old of extra) await removeRecentFile(old.hash)
}

export async function readRecentFile(hash: string): Promise<LoadedMidiFile> {
  const file = await run(
    'readonly',
    (store) => store.get(hash) as IDBRequest<StoredFile | undefined>
  )
  if (!file) throw new Error('This file is no longer in the recent files list.')
  return { name: file.name, path: file.name, hash: file.hash, data: file.data }
}

export async function removeRecentFile(hash: string): Promise<void> {
  await run('readwrite', (store) => store.delete(hash))
}

export async function clearRecentFiles(): Promise<void> {
  await run('readwrite', (store) => store.clear())
}
