// Downloads the GeneralUser GS SoundFont (license: resources/soundfonts/GeneralUser-GS-LICENSE.txt)
// into resources/soundfonts/. Usage: node scripts/fetch-soundfont.mjs
// Pinned to one commit and checked by hash, so every build ships the same sounds.
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const COMMIT = '684543d5e5efaef08d02be50dcda8d552478fa60' // GeneralUser GS 2.0.3, February 2026
const BASE = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${COMMIT}`
const DIR = 'resources/soundfonts'
const FILES = [
  {
    url: `${BASE}/GeneralUser-GS.sf2`,
    path: `${DIR}/GeneralUser-GS.sf2`,
    sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe'
  },
  {
    url: `${BASE}/documentation/LICENSE.txt`,
    path: `${DIR}/GeneralUser-GS-LICENSE.txt`,
    sha256: '7b32efefdf95ce38a043799f0659853ddc00fbaa14d8c50f0aca16b9b8b405be'
  }
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

mkdirSync(DIR, { recursive: true })
for (const { url, path, sha256: expected } of FILES) {
  if (existsSync(path) && sha256(readFileSync(path)) === expected) {
    console.log(`${path} is up to date`)
    continue
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== expected) throw new Error(`Unexpected contents (hash mismatch): ${url}`)
  writeFileSync(path, bytes)
  console.log(`Downloaded ${path}`)
}
