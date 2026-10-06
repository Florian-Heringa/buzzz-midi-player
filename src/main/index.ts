import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { IpcChannels, type LoadedMidiFile, type MenuCommand } from '../shared/api'
import { registerExportHandlers } from './export/exportHandler'

const MIDI_FILTERS = [{ name: 'MIDI files', extensions: ['mid', 'midi'] }]
const PRESET_FILTERS = [{ name: 'Player presets', extensions: ['json'] }]
const MIDI_EXTENSION = /\.midi?$/i
const SOUNDFONT_FILE = 'GeneralUser-GS.sf2'
const SHA1_HEX = /^[0-9a-f]{40}$/

let mainWindow: BrowserWindow | null = null

async function loadMidiFile(path: string): Promise<LoadedMidiFile> {
  const buffer = await readFile(path)
  const hash = createHash('sha1').update(buffer).digest('hex')
  return { name: basename(path), path, hash, data: new Uint8Array(buffer) }
}

/** Auto-saved presets live in the user data folder, one JSON file per MIDI file hash. */
function autoPresetPath(hash: string): string {
  // The hash becomes a file name, so only accept what loadMidiFile produces.
  if (!SHA1_HEX.test(hash)) throw new Error('Invalid file hash')
  return join(app.getPath('userData'), 'presets', `${hash}.json`)
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** SoundFonts ship as extra resources when packaged and live in resources/ during development. */
function soundFontPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'soundfonts', SOUNDFONT_FILE)
}

function sendMenuCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IpcChannels.menuCommand, command)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open MIDI…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCommand('open-midi')
        },
        { type: 'separator' },
        {
          label: 'Save Preset As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuCommand('save-preset')
        },
        {
          label: 'Load Preset…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuCommand('load-preset')
        },
        {
          label: 'Export MP3…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuCommand('export-mp3')
        },
        { type: 'separator' },
        {
          label: 'Reset Mix and Tempo',
          click: () => sendMenuCommand('reset-settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.openMidiDialog, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: MIDI_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return loadMidiFile(result.filePaths[0])
  })

  ipcMain.handle(IpcChannels.readMidiFile, (_event, path: string) => loadMidiFile(path))

  // The renderer asks once on startup for a file the app was launched with.
  let launchPath = midiPathFromArgs(process.argv)
  ipcMain.handle(IpcChannels.takeLaunchFile, async () => {
    const path = launchPath
    launchPath = undefined
    return path ? loadMidiFile(path) : null
  })

  ipcMain.handle(IpcChannels.readAutoPreset, async (_event, hash: string) => {
    try {
      return await readJson(autoPresetPath(hash))
    } catch {
      return null // none saved yet, or unreadable: start from defaults
    }
  })

  ipcMain.handle(IpcChannels.writeAutoPreset, async (_event, hash: string, preset: unknown) => {
    const path = autoPresetPath(hash)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(preset, null, 2))
  })

  ipcMain.handle(IpcChannels.savePresetDialog, async (_event, preset: unknown, defaultName: string) => {
    if (!mainWindow) return false
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: PRESET_FILTERS
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, JSON.stringify(preset, null, 2))
    return true
  })

  ipcMain.handle(IpcChannels.openPresetDialog, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: PRESET_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      return await readJson(result.filePaths[0])
    } catch {
      throw new Error(`${basename(result.filePaths[0])} is not a valid JSON file.`)
    }
  })

  registerExportHandlers(() => mainWindow, soundFontPath)

  ipcMain.handle(IpcChannels.loadSoundFont, async () => {
    const path = soundFontPath()
    try {
      return new Uint8Array(await readFile(path))
    } catch {
      throw new Error(`SoundFont not found at ${path}. Run "npm run fetch-soundfont".`)
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Electron MIDI Player',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** A MIDI file passed on the command line, e.g. when opened from Explorer. */
function midiPathFromArgs(argv: string[]): string | undefined {
  return argv.slice(1).find((arg) => !arg.startsWith('--') && MIDI_EXTENSION.test(arg))
}

// One window: opening another MIDI file from Explorer loads it into the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', async (_event, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    const path = midiPathFromArgs(argv)
    if (!path) return
    try {
      mainWindow.webContents.send(IpcChannels.openFile, await loadMidiFile(path))
    } catch (err) {
      dialog.showErrorBox('Could not open file', err instanceof Error ? err.message : String(err))
    }
  })

  app.whenReady().then(() => {
    buildMenu()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
