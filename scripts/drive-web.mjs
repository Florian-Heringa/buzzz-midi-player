// Smoke test for the web version: drives the web build (npm run build:web first) in an installed
// Chrome or Edge, served under /buzzz-midi-player/ like GitHub Pages.
// Usage: node scripts/drive-web.mjs  (set BROWSER to the browser's executable to pick one)
// Opens samples/satb-chorale.mid with the file picker, then checks playback output, auto-saved
// settings, preset download and upload, MP3 export, the recent list after a reload and
// drag-and-drop. Each run uses a fresh browser profile.
import { chromium } from 'playwright-core'
import { createServer } from 'http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { extname, join, resolve } from 'path'

const APP = resolve(import.meta.dirname, '..')
const ROOT = resolve(APP, 'out/web')
const MIDI = resolve(APP, 'samples/satb-chorale.mid')
const SHOTS = resolve(process.env.SCREENSHOT_DIR ?? resolve(APP, 'out/shots'))
mkdirSync(SHOTS, { recursive: true })
const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]
const executablePath = BROWSERS.find((path) => path && existsSync(path))
if (!executablePath) throw new Error('No Chrome or Edge found; set BROWSER to its executable')
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.txt': 'text/plain'
}
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!url.startsWith('/buzzz-midi-player/')) {
    res.statusCode = 404
    return res.end()
  }
  const file = join(ROOT, url.slice('/buzzz-midi-player/'.length) || 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.statusCode = 404
    return res.end()
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}/buzzz-midi-player/`

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  executablePath,
  args: ['--autoplay-policy=no-user-gesture-required']
})
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`))
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
await page.addInitScript(() => {
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && !window.__level) {
      const a = this.context.createAnalyser()
      a.fftSize = 2048
      connect.call(this, a)
      const buf = new Float32Array(a.fftSize)
      window.__level = () => {
        a.getFloatTimeDomainData(buf)
        return Math.max(...buf.map(Math.abs))
      }
    }
    return connect.call(this, target, ...rest)
  }
})

try {
  await page.goto(BASE)
  await page.waitForSelector('.start-screen')
  check('start screen renders on the web', true)
  const links = await page
    .locator('.start-screen__desktop a')
    .evaluateAll((anchors) => anchors.map((a) => a.href))
  check(
    'desktop download and license links shown',
    links.length === 2 &&
      links[0].includes('/releases') &&
      links[1] === `${BASE}THIRD_PARTY_NOTICES.txt`
  )
  const notices = await page.request.get(`${BASE}THIRD_PARTY_NOTICES.txt`)
  check(
    'license notices are served with the page',
    notices.ok() && (await notices.text()).includes('FluidSynth')
  )

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Open MIDI…' }).click()
  ])
  await chooser.setFiles(MIDI)
  await page.waitForSelector('.strip__name', { timeout: 30000 })
  check(
    'file opens through the picker',
    (await page.locator('.top-bar__file').innerText()).includes('satb')
  )
  check(
    'preset buttons shown on the web',
    (await page.getByRole('button', { name: 'Save preset…' }).count()) === 1
  )

  // Wait for the engine (SoundFont download) before playing.
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, {
    timeout: 60000
  })
  await page.keyboard.press('Space')
  let peak = 0
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100)
    peak = Math.max(peak, await page.evaluate(() => window.__level?.() ?? 0))
  }
  await page.keyboard.press('Space')
  console.log('peak level', peak.toFixed(3))
  check('playback makes sound', peak > 0.01)

  await page.locator('.strip__name').nth(1).click()
  await page.waitForTimeout(900)
  const presetKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('buzzz.preset.'))
  )
  check('settings auto-saved to localStorage', presetKeys.length === 1)

  const [presetDl] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+Shift+S')
  ])
  const presetPath = await presetDl.path()
  const presetJson = JSON.parse(readFileSync(presetPath, 'utf8'))
  check(
    'Ctrl+Shift+S downloads a preset',
    presetDl.suggestedFilename().endsWith('preset.json') && typeof presetJson === 'object'
  )

  const [chooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load preset…' }).click()
  ])
  await chooser2.setFiles(presetPath)
  await page.waitForTimeout(300)
  check('load preset reports success', (await page.content()).includes('Preset loaded'))

  await page.keyboard.press('Control+e')
  await page.waitForSelector('dialog[open]')
  const [mp3] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.locator('dialog[open] .button--primary').click()
  ])
  const bytes = readFileSync(await mp3.path())
  console.log('mp3', mp3.suggestedFilename(), bytes.length, 'bytes')
  check(
    'export downloads an MP3',
    mp3.suggestedFilename().endsWith('.mp3') &&
      bytes.length > 50000 &&
      (bytes[0] === 0xff || bytes.subarray(0, 3).toString() === 'ID3')
  )
  await page.waitForTimeout(300)
  check(
    'no Show in folder entry after a web export',
    (await page.locator('.last-export').count()) === 0
  )
  await page.screenshot({ path: join(SHOTS, 'web-song.png') })

  await page.reload()
  await page.waitForSelector('.start-screen__file')
  check('recent list survives reload', (await page.locator('.start-screen__file').count()) === 1)
  await page.screenshot({ path: join(SHOTS, 'web-start.png') })
  await page.locator('.start-screen__file').click()
  await page.waitForSelector('.strip__name', { timeout: 30000 })
  check('recent file reopens', (await page.locator('.top-bar__file').innerText()).includes('satb'))

  await page.reload()
  await page.waitForSelector('.start-screen')
  const data = readFileSync(MIDI).toString('base64')
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'dropped.mid', { type: 'audio/midi' }))
    const target = document.querySelector('.start-screen') ?? document.body
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
      )
    }
  }, data)
  await page.waitForSelector('.strip__name', { timeout: 30000 })
  check(
    'dropped file opens',
    (await page.locator('.top-bar__file').innerText()).includes('dropped')
  )
} catch (err) {
  console.log('ERROR', err)
  failures++
}

console.log('errors:', errors.length ? errors : 'none')
check('no page errors', errors.length === 0)
await browser.close()
server.close()
process.exitCode = failures ? 1 : 0
