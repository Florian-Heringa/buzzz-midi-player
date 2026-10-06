// Downloads the GeneralUser GS SoundFont (license: resources/soundfonts/GeneralUser-GS-LICENSE.txt)
// into resources/soundfonts/. Usage: node scripts/fetch-soundfont.mjs
import { existsSync, mkdirSync, writeFileSync } from 'fs'

const BASE = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main'
const DIR = 'resources/soundfonts'
const FILES = [
  { url: `${BASE}/GeneralUser-GS.sf2`, path: `${DIR}/GeneralUser-GS.sf2` },
  { url: `${BASE}/documentation/LICENSE.txt`, path: `${DIR}/GeneralUser-GS-LICENSE.txt` }
]

mkdirSync(DIR, { recursive: true })
for (const { url, path } of FILES) {
  if (existsSync(path)) {
    console.log(`${path} already exists`)
    continue
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
  console.log(`Downloaded ${path}`)
}
