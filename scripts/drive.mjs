// Smoke test: drives the built app (npm run build first) with Playwright.
// Usage: node scripts/drive.mjs [midi-file]
// Set APP_EXECUTABLE to test a packaged build (npm run build:dir) instead.
// To test against the dev server instead, run `npx electron-vite dev --rendererOnly` and set
// ELECTRON_RENDERER_URL to its URL (main and preload still come from the last build).
// Opens the MIDI file through File > Open (the dialog is stubbed), then checks playback:
// audio output level, playhead movement, pause, tempo scaling and seeking.
// The staff checks work for any file; the playback checks assume samples/satb-chorale.mid
// (80 BPM, 25 s long).
// The app runs with a fresh, temporary user data folder, so your own settings are untouched.
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const APP_DIR = resolve(import.meta.dirname, '..')
const MIDI = resolve(APP_DIR, process.argv[2] ?? 'samples/satb-chorale.mid')
const SHOT_DIR = resolve(process.env.SCREENSHOT_DIR ?? resolve(APP_DIR, 'out/shots'))
mkdirSync(SHOT_DIR, { recursive: true })
const USER_DATA = mkdtempSync(join(tmpdir(), 'midi-player-smoke-'))

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

// APP_EXECUTABLE runs a packaged build instead, e.g. "dist/win-unpacked/Electron MIDI Player.exe".
const packaged = process.env.APP_EXECUTABLE ? resolve(APP_DIR, process.env.APP_EXECUTABLE) : null
const app = await electron.launch({
  executablePath: packaged ?? resolve(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: [...(packaged ? [] : [APP_DIR]), `--user-data-dir=${USER_DATA}`],
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
  await page.waitForSelector('.strip')
  console.log('tracks:', (await page.locator('.strip__name').allInnerTexts()).join(', '))
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

  // Staff: one notehead per note for each track, screenshot per track.
  const names = await page.locator('.strip__name').allInnerTexts()
  for (let i = 0; i < names.length; i++) {
    await page.locator('.strip__name').nth(i).click()
    const expected = Number((await page.locator('.strip__meta').nth(i).getAttribute('title')).match(/(\d+) notes/)?.[1])
    const heads = await page.locator('.staff-view__svg .staff__notehead:not(.staff__notehead--sounding)').count()
    check(`staff shows every ${names[i]} note`, heads === expected, `${heads}/${expected}`)
    await page.locator('.staff-view').screenshot({ path: resolve(SHOT_DIR, `staff-${names[i]}.png`) })
  }
  await page.locator('.strip__name').first().click()
  await page.screenshot({ path: resolve(SHOT_DIR, 'layout.png') })

  // Layout: dragging the divider between staff and mixer resizes both panes.
  const paneHeights = () =>
    page.locator('.split-panes__pane').evaluateAll((panes) => panes.map((p) => p.clientHeight))
  const before = await paneHeights()
  const divider = page.locator('.split-panes__divider').nth(1)
  const box = await divider.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 5 })
  await page.mouse.up()
  const after = await paneHeights()
  check(
    'dragging a divider resizes the panes next to it',
    Math.abs(after[1] - (before[1] - 80)) <= 2 && Math.abs(after[2] - (before[2] + 80)) <= 2 && after[0] === before[0],
    `${before.join('/')} → ${after.join('/')}`
  )
  const savedSizes = await page.evaluate(() => localStorage.getItem('pane-layout'))
  check('pane sizes are remembered', savedSizes !== null)
  await page.locator('.split-panes__divider').nth(1).dblclick()

  // Loop controls (playback does not loop yet): typing is free; the range is checked on blur.
  const loopStart = page.locator('input[aria-label="Loop start bar"]')
  const loopEnd = page.locator('input[aria-label="Loop end bar"]')
  check('loop range defaults to the whole song', (await loopStart.inputValue()) === '1' && (await loopEnd.inputValue()) === '8')
  await loopEnd.click()
  await page.keyboard.type('12') // out of range: must not be corrected while typing
  const typed = await loopEnd.inputValue()
  await page.keyboard.press('Tab')
  check('typing is not corrected mid-entry', typed === '12', `typed "${typed}"`)
  check('loop bar is validated when leaving the field', (await loopEnd.inputValue()) === '8')
  await loopStart.click()
  await page.keyboard.type('7')
  await page.keyboard.press('Enter')
  await loopEnd.click()
  await page.keyboard.type('6')
  await page.keyboard.press('Tab')
  check('loop start follows an earlier end', (await loopStart.inputValue()) === '6' && (await loopEnd.inputValue()) === '6')
  await loopStart.click()
  await page.keyboard.type('3')
  await page.keyboard.press('Tab')

  // Stop returns to the loop start (bar 3 = tick 3840) only while the loop is on.
  await page.click('text=⟲ Loop')
  check('loop toggle', (await page.locator('text=⟲ Loop').getAttribute('aria-pressed')) === 'true')
  await setRange('.transport__position', 6000)
  await page.click('button[aria-label="Stop"]')
  check('stop returns to the loop start', (await page.locator('.transport__position').inputValue()) === '3840')
  await page.click('text=⟲ Loop')
  await page.click('button[aria-label="Stop"]')
  check('stop returns to the song start without loop', (await page.locator('.transport__position').inputValue()) === '0')

  // Knobs: keyboard and vertical drag.
  const volumeKnob = page.locator('[role="slider"][aria-label="Soprano volume"]')
  await volumeKnob.focus()
  await page.keyboard.press('ArrowDown')
  check('volume knob responds to the keyboard', (await volumeKnob.getAttribute('aria-valuenow')) === '99')
  const knobBox = await volumeKnob.boundingBox()
  await page.mouse.move(knobBox.x + knobBox.width / 2, knobBox.y + knobBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(knobBox.x + knobBox.width / 2, knobBox.y + knobBox.height / 2 - 40, { steps: 4 })
  await page.mouse.up()
  const dragged = Number(await volumeKnob.getAttribute('aria-valuenow'))
  check('dragging a knob up raises it', dragged > 120, `value ${dragged}`)
  await volumeKnob.dblclick()
  check('double-click resets a knob', (await volumeKnob.getAttribute('aria-valuenow')) === '100')

  // Mixer pane can't be squeezed below its content.
  const mixerDivider = page.locator('.split-panes__divider').nth(1)
  const mixerBox = await mixerDivider.boundingBox()
  await page.mouse.move(mixerBox.x + 200, mixerBox.y + 3)
  await page.mouse.down()
  await page.mouse.move(mixerBox.x + 200, mixerBox.y + 600, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const fit = await page.evaluate(() => {
    const pane = document.querySelectorAll('.split-panes__pane')[2]
    const toggles = [...pane.querySelectorAll('.strip__toggles')]
    const paneBox = pane.getBoundingClientRect()
    return {
      pane: Math.round(paneBox.height),
      content: pane.scrollHeight,
      visible: toggles.every((t) => t.getBoundingClientRect().bottom <= paneBox.bottom + 1)
    }
  })
  check('mixer pane never cuts off strip content', fit.visible && fit.pane >= fit.content - 1, `pane ${fit.pane}px, content ${fit.content}px`)
  await page.screenshot({ path: resolve(SHOT_DIR, 'mixer-minimum.png') })
  await mixerDivider.dblclick()

  const cursor = await page.locator('.staff-view__svg').evaluate((el) => getComputedStyle(el).cursor)
  check('staff shows a pointer cursor', cursor === 'pointer', cursor)

  // Pane layout: the staff pane fits its content and the mixer takes the rest.
  const staffFit = () =>
    page.evaluate(() => {
      const pane = document.querySelectorAll('.split-panes__pane')[1]
      const content = pane.firstElementChild.getBoundingClientRect().height
      return { pane: Math.round(pane.getBoundingClientRect().height), content: Math.round(content) }
    })
  const fitted = await staffFit()
  check('staff pane fits the staff', Math.abs(fitted.pane - fitted.content) <= 1, `pane ${fitted.pane}px, content ${fitted.content}px`)
  const mixerFills = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.split-panes__pane')]
    const root = document.querySelector('.split-panes').getBoundingClientRect()
    return Math.abs(panes[2].getBoundingClientRect().bottom - root.bottom) <= 1
  })
  check('mixer stretches to the bottom of the window', mixerFills)

  // Selection: labels are not selectable; song details values are.
  const selectionAfterDblclick = async (locator) => {
    await page.evaluate(() => window.getSelection().removeAllRanges())
    await locator.dblclick()
    return page.evaluate(() => window.getSelection().toString().trim())
  }
  check('song detail labels are not selectable', (await selectionAfterDblclick(page.locator('.song-summary dt').first())) === '')
  check('song detail values are selectable', (await selectionAfterDblclick(page.locator('.song-summary dd').nth(1))) !== '')
  check('mixer text is not selectable', (await selectionAfterDblclick(page.locator('.strip__meta').first())) === '')
  await setRange('.transport__tempo input', 60)
  const tempoLabelSelection = await selectionAfterDblclick(page.locator('.transport__tempo .control-group__label'))
  check(
    'double-clicking the Tempo label resets the tempo',
    tempoLabelSelection === '' && (await page.locator('.transport__tempo input').inputValue()) === '100'
  )
  const panKnob = page.locator('[role="slider"][aria-label="Alto pan"]')
  await panKnob.focus()
  await page.keyboard.press('ArrowLeft')
  await page.locator('.knob__text', { hasText: 'Pan L' }).dblclick()
  check('double-clicking a knob label resets the knob', (await panKnob.getAttribute('aria-valuenow')) === '0')

  // Renaming a track: double-click the strip name.
  await page.locator('.strip__name').first().dblclick()
  await page.keyboard.type('Lead voice')
  await page.keyboard.press('Enter')
  check(
    'double-click renames a track',
    (await page.locator('.strip__name').first().innerText()) === 'Lead voice' &&
      (await page.locator('.practice-header__title').innerText()) === 'Lead voice'
  )
  await page.locator('.strip__name').nth(1).dblclick()
  await page.keyboard.type('Ignored')
  await page.keyboard.press('Escape')
  check('Escape cancels a rename', (await page.locator('.strip__name').nth(1).innerText()) === 'Alto')
  await page.screenshot({ path: resolve(SHOT_DIR, 'fitted-layout.png') })

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

  const scrollLeft = () => page.locator('.staff-view__scroller').evaluate((el) => el.scrollLeft)
  const scrollBefore = await scrollLeft()
  await page.waitForTimeout(1000)
  const scrollAfter = await scrollLeft()
  check('staff follows the playhead', scrollAfter > scrollBefore, `scrollLeft ${scrollBefore} → ${scrollAfter}`)
  const meterHeights = await page
    .locator('.strip__meter-fill')
    .evaluateAll((fills) => fills.map((f) => f.getBoundingClientRect().height))
  check('level meters move while playing', meterHeights.some((h) => h > 5), meterHeights.map(Math.round).join('/'))
  check('a sounding note is highlighted', (await page.locator('.staff__notehead--sounding').count()) > 0)
  await page.screenshot({ path: resolve(SHOT_DIR, 'staff-playing.png') })

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
  const muteButtons = page.locator('.strip__toggle[title="Mute"]')
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
  const silencedRows = await page.locator('.strip--silenced').count()
  check('solo part silences the other tracks', silencedRows === trackCount - 1, `${silencedRows} silenced`)
  const soloLevel = await level()
  check('soloed part is audible', soloLevel > 0.001, `RMS ${soloLevel.toFixed(4)}`)
  await page.click('text=Solo part')

  await page.locator('.strip__instrument').first().selectOption('73') // Flute
  await page.waitForTimeout(500)
  check('instrument change keeps playing', (await level()) > 0.001)
  await page.screenshot({ path: resolve(SHOT_DIR, 'mixer.png') })

  await page.click('.transport__play')
  await page.waitForTimeout(200) // pause settles the final position asynchronously
  const pausedAt = await tick()
  await page.waitForTimeout(800)
  check('pause holds position', (await tick()) === pausedAt, `tick ${pausedAt}`)
  const silence = await level()
  check('pause silences output', silence < 0.01, `RMS ${silence.toFixed(4)}`)

  // Presets: changes are auto-saved per file and restored when the file is reopened.
  const clickMenu = (label) =>
    app.evaluate(({ Menu }, text) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((menu) => menu.submenu?.items ?? [])
        .find((i) => i.label === text)
      item.click()
    }, label)
  const tempoValue = () => page.locator('.transport__tempo input').inputValue()
  const altoMuted = () =>
    page.locator('.strip__toggle[title="Mute"]').nth(1).getAttribute('aria-pressed')

  await setRange('.transport__tempo input', 75)
  await page.locator('.strip__toggle[title="Mute"]').nth(1).click() // mute Alto
  await page.waitForTimeout(1000) // auto-save is debounced
  const presetDir = join(USER_DATA, 'presets')
  const autoFiles = existsSync(presetDir) ? readdirSync(presetDir) : []
  const autoSaved = autoFiles.length === 1 ? JSON.parse(readFileSync(join(presetDir, autoFiles[0]), 'utf8')) : null
  check(
    'changes are auto-saved',
    autoSaved?.tempoFactor === 0.75 && autoSaved.tracks[1].muted === true && autoSaved.tracks[0].label === 'Lead voice'
  )

  await page.click('text=Open MIDI') // reopen the same file
  await page.waitForSelector('text=Restored your settings')
  check(
    'reopening restores tempo, mix and track names',
    (await tempoValue()) === '75' &&
      (await altoMuted()) === 'true' &&
      (await page.locator('.strip__name').first().innerText()) === 'Lead voice'
  )

  const presetFile = join(USER_DATA, 'my preset.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, presetFile)
  await clickMenu('Save Preset As…')
  await page.waitForSelector('text=Preset saved')
  check('preset saved to file', existsSync(presetFile))

  await clickMenu('Reset Mix and Tempo')
  await page.waitForTimeout(200)
  check(
    'reset restores defaults but keeps track names',
    (await tempoValue()) === '100' &&
      (await altoMuted()) === 'false' &&
      (await page.locator('.strip__name').first().innerText()) === 'Lead voice'
  )

  await clickMenu('Load Preset…')
  await page.waitForSelector('text=Preset loaded')
  check('loading a preset applies it', (await tempoValue()) === '75' && (await altoMuted()) === 'true')

  // Export: render the current mix (tempo is 75% from the preset) and decode the MP3.
  const mp3File = join(USER_DATA, 'export.mp3')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, mp3File)
  await page.click('text=Export MP3…')
  await page.click('.export-dialog input[value="mix"]')
  const started = Date.now()
  await page.click('.export-dialog .button--primary')
  await page.waitForFunction(
    () =>
      document.querySelector('.error') ||
      document.querySelector('.last-export'),
    null,
    { timeout: 120_000 }
  )
  const exportError = await page.locator('.error').allInnerTexts()
  if (exportError.length) console.log('export error:', exportError.join('; '))
  const renderSeconds = (Date.now() - started) / 1000
  const decoded = existsSync(mp3File)
    ? await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const audio = await new AudioContext().decodeAudioData(bytes.buffer)
        const data = audio.getChannelData(0)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        return { duration: audio.duration, rms: Math.sqrt(sum / data.length) }
      }, readFileSync(mp3File).toString('base64'))
    : null
  // 25.4 s at 75% tempo ≈ 33.9 s, plus up to 4 s of release tail.
  const expected = 25.43 / 0.75
  check(
    'MP3 export has the song length at the chosen tempo',
    decoded !== null && decoded.duration > expected && decoded.duration < expected + 4.5,
    decoded ? `${decoded.duration.toFixed(1)} s, rendered in ${renderSeconds.toFixed(1)} s` : 'no file'
  )
  check('MP3 export is not silent', (decoded?.rms ?? 0) > 0.005, `RMS ${decoded?.rms.toFixed(4)}`)

  // The exported file is listed in the top bar; clicking it reveals the file in Explorer.
  // shell is stubbed so no Explorer window opens during the test.
  await app.evaluate(({ shell }) => {
    globalThis.__revealed = []
    shell.showItemInFolder = (path) => globalThis.__revealed.push(['item', path])
    shell.openPath = async (path) => {
      globalThis.__revealed.push(['folder', path])
      return ''
    }
  })
  const chip = page.locator('.last-export__open')
  check('exported file is listed in the top bar', (await page.locator('.last-export__name').innerText()) === 'export.mp3')
  await chip.click()
  await page.waitForTimeout(200)
  const revealed = await app.evaluate(() => globalThis.__revealed)
  check(
    'clicking it shows the file in its folder',
    revealed.length === 1 && revealed[0][0] === 'item' && revealed[0][1] === mp3File,
    JSON.stringify(revealed)
  )
  await page.screenshot({ path: resolve(SHOT_DIR, 'last-export.png') })
  rmSync(mp3File)
  await chip.click()
  await page.waitForSelector('.error')
  const afterDelete = await app.evaluate(() => globalThis.__revealed)
  check(
    'a deleted export opens its folder and says so',
    afterDelete[1]?.[0] === 'folder' && afterDelete[1][1] === USER_DATA &&
      (await page.locator('.error').innerText()).includes('moved or deleted')
  )
  await page.click('.last-export__dismiss')
  check('the export entry can be dismissed', (await page.locator('.last-export').count()) === 0)

  // Cancelling mid-render leaves no file and no error.
  const cancelledFile = join(USER_DATA, 'cancelled.mp3')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, cancelledFile)
  await page.click('text=Export MP3…')
  await page.click('.export-dialog .button--primary')
  await page.waitForSelector('.export-dialog__progress')
  await page.click('.export-dialog >> text=Cancel')
  await page.waitForTimeout(3000)
  check(
    'cancelled export writes nothing',
    !existsSync(cancelledFile) && (await page.locator('.export-dialog').count()) === 0
  )

  const uiErrors = await page.locator('.error').allInnerTexts()
  check('no error banner', uiErrors.length === 0, uiErrors.join('; '))
} finally {
  check('no console errors', errors.length === 0, errors.join('\n  '))
  await app.close()
  rmSync(USER_DATA, { recursive: true, force: true })
}
process.exit(results.every(Boolean) ? 0 : 1)
