// Smoke test: drives the built app (npm run build first) with Playwright.
// Usage: node scripts/drive.mjs [midi-file]
// To test against the dev server instead, run `npx electron-vite dev --rendererOnly` and set
// ELECTRON_RENDERER_URL to its URL (main and preload still come from the last build).
// Opens the MIDI file through File > Open (the dialog is stubbed), then checks playback:
// audio output level, playhead movement, pause, tempo scaling and seeking.
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const APP_DIR = resolve(import.meta.dirname, '..')
const MIDI = resolve(APP_DIR, process.argv[2] ?? 'samples/satb-chorale.mid')
const SHOT_DIR = resolve(process.env.SCREENSHOT_DIR ?? resolve(APP_DIR, 'out/shots'))
mkdirSync(SHOT_DIR, { recursive: true })

/** Runs in the page before the app: taps everything connected to the speakers. */
function installOutputTap() {
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && !window.__outputLevel) {
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 2048
      connect.call(this, analyser)
      const buffer = new Float32Array(analyser.fftSize)
      window.__outputLevel = () => {
        analyser.getFloatTimeDomainData(buffer)
        return Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length)
      }
    }
    return connect.call(this, target, ...rest)
  }
}

const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const app = await electron.launch({
  executablePath: resolve(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: [APP_DIR],
  env: { ...process.env },
  timeout: 30_000
})
const errors = []
try {
  const page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
  await page.context().addInitScript(installOutputTap)
  await page.reload()
  await page.waitForSelector('text=Open MIDI')
  console.log('renderer:', page.url())

  // Make the open dialog return the MIDI file without user interaction.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, MIDI)
  await page.click('text=Open MIDI')
  await page.waitForSelector('.track-list__item')
  console.log('tracks:', (await page.locator('.track-list__name').allInnerTexts()).join(', '))
  await page.waitForFunction(() => !document.querySelector('.transport__status'), null, {
    timeout: 30_000
  })

  const tick = async () => Number(await page.locator('.transport__position').inputValue())
  const level = () => page.evaluate(() => window.__outputLevel?.() ?? -1)
  const setRange = (selector, value) =>
    page.locator(selector).evaluate((input, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  const ticksPerSecond = async () => {
    const start = await tick()
    await page.waitForTimeout(1000)
    return (await tick()) - start
  }

  await page.click('.transport__play')
  await page.waitForTimeout(500)
  const levels = []
  for (let i = 0; i < 5; i++) {
    levels.push(await level())
    await page.waitForTimeout(100)
  }
  const peak = Math.max(...levels)
  check('audio reaches the output', peak > 0.001, `RMS peak ${peak.toFixed(4)}`)

  const normalRate = await ticksPerSecond()
  // Sample at 80 BPM, 480 ppq → 640 ticks per second.
  check('playhead advances at file tempo', Math.abs(normalRate - 640) < 100, `${normalRate} ticks/s`)
  await page.screenshot({ path: resolve(SHOT_DIR, 'playing.png') })

  await setRange('.transport__tempo input', 50)
  await page.waitForTimeout(200)
  const slowRate = await ticksPerSecond()
  check('tempo 50% halves the tick rate', Math.abs(slowRate - normalRate / 2) < 80, `${slowRate} ticks/s`)
  await setRange('.transport__tempo input', 100)

  await setRange('.transport__position', 7680) // bar 5
  await page.waitForTimeout(600)
  const afterSeek = await tick()
  check('seek jumps and keeps playing', afterSeek > 7680 && afterSeek < 7680 + 800, `tick ${afterSeek}`)

  // Mixer: mute every track, then seek back. The player replays volume events on seek, so
  // this also checks that the worklet hook keeps the muted values.
  const muteButtons = page.locator('.mixer__toggle[title="Mute"]')
  const trackCount = await muteButtons.count()
  for (let i = 0; i < trackCount; i++) await muteButtons.nth(i).click()
  await page.waitForTimeout(1500) // let release tails and reverb fade
  const mutedLevel = await level()
  check('muting all tracks silences output', mutedLevel < 0.003, `RMS ${mutedLevel.toFixed(4)}`)
  await setRange('.transport__position', 0)
  await page.waitForTimeout(1000)
  const mutedAfterSeek = await level()
  check('mute survives a seek', mutedAfterSeek < 0.003, `RMS ${mutedAfterSeek.toFixed(4)}`)
  for (let i = 0; i < trackCount; i++) await muteButtons.nth(i).click()

  await page.click('text=Solo part')
  await page.waitForTimeout(800)
  const silencedRows = await page.locator('.track-list__item--silenced').count()
  check('solo part silences the other tracks', silencedRows === trackCount - 1, `${silencedRows} silenced`)
  const soloLevel = await level()
  check('soloed part is audible', soloLevel > 0.001, `RMS ${soloLevel.toFixed(4)}`)
  await page.click('text=Solo part')

  await page.locator('.mixer__instrument').first().selectOption('73') // Flute
  await page.waitForTimeout(500)
  check('instrument change keeps playing', (await level()) > 0.001)
  await page.screenshot({ path: resolve(SHOT_DIR, 'mixer.png') })

  await page.click('.transport__play')
  const pausedAt = await tick()
  await page.waitForTimeout(800)
  check('pause holds position', (await tick()) === pausedAt, `tick ${pausedAt}`)
  const silence = await level()
  check('pause silences output', silence < 0.01, `RMS ${silence.toFixed(4)}`)

  const uiErrors = await page.locator('.error').allInnerTexts()
  check('no error banner', uiErrors.length === 0, uiErrors.join('; '))
} finally {
  check('no console errors', errors.length === 0, errors.join('\n  '))
  await app.close()
}
process.exit(results.every(Boolean) ? 0 : 1)
