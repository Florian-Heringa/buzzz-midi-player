import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { createHash } from 'crypto'
import { cpSync, existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { IpcChannels, type LoadedMidiFile, type MenuCommand } from '../shared/api'
import { registerExportHandlers } from './export/exportHandler'
import { describeRecent, RecentFilesStore } from './recentFiles'

const MIDI_FILTERS = [{ name: 'MIDI files', extensions: ['mid', 'midi'] }]
const PRESET_FILTERS = [{ name: 'Player presets', extensions: ['json'] }]
const MIDI_EXTENSION = /\.midi?$/i
const SOUNDFONT_FILE = 'GeneralUser-GS.sf2'
const SHA1_HEX = /^[0-9a-f]{40}$/

const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null
/** Recently opened MIDI files; created once the app is ready (it needs the user data path). */
let recent: RecentFilesStore | null = null
/** A file to open once the window's page asks for it (launched with one, or opened meanwhile). */
let launchPath = midiPathFromArgs(process.argv)
/** Whether the window's page has asked for the launch file, i.e. is listening for files. */
let rendererListening = false

/** User data folder names from before the app was called Buzzz Midi Player (dev, packaged). */
const OLD_USER_DATA_NAMES = ['electron-midi-player', 'Electron MIDI Player']
/** Files that belong to a running instance; never copied. */
const INSTANCE_FILES = /^(Singleton(Lock|Cookie|Socket)|lockfile)$/

/**
 * Brings settings, presets and recent files over from the old app name, the first time the
 * renamed app runs. Must run before anything (like the single-instance lock) writes there.
 */
function migrateUserData(): void {
  const current = app.getPath('userData')
  // Only the default folder: a folder chosen with --user-data-dir (tests) stays as it is.
  if (current !== join(app.getPath('appData'), app.getName())) return
  const hasData = ['Local Storage', 'presets', 'recent-files.json'].some((name) => existsSync(join(current, name)))
  if (hasData) return
  for (const name of OLD_USER_DATA_NAMES) {
    const old = join(app.getPath('appData'), name)
    if (!existsSync(old)) continue
    try {
      cpSync(old, current, {
        recursive: true,
        force: false,
        filter: (source) => !INSTANCE_FILES.test(basename(source))
      })
    } catch (err) {
      console.warn('Could not copy settings from', old, err)
    }
    return
  }
}

/** Reads a MIDI file and remembers it as recently opened (every way of opening goes here). */
async function loadMidiFile(path: string): Promise<LoadedMidiFile> {
  const buffer = await readFile(path)
  const hash = createHash('sha1').update(buffer).digest('hex')
  void rememberRecent(path)
  return { name: basename(path), path, hash, data: new Uint8Array(buffer) }
}

async function rememberRecent(path: string): Promise<void> {
  if (!recent) return
  await recent.add(path)
  app.addRecentDocument(path) // Windows jump list, macOS Dock menu
  recentFilesChanged()
}

/** Updates File > Open Recent and the start screen. */
function recentFilesChanged(): void {
  buildMenu()
  if (recent) mainWindow?.webContents.send(IpcChannels.recentFilesChanged, describeRecent(recent.entries))
}

/** Opens a recent file from the menu, or offers to forget it if it is gone. */
async function openRecentFromMenu(path: string): Promise<void> {
  if (!mainWindow) return
  try {
    mainWindow.webContents.send(IpcChannels.openFile, await loadMidiFile(path))
  } catch {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: `${basename(path)} could not be opened.`,
      detail: 'It may have been moved or deleted.',
      buttons: ['Remove from Recent', 'Keep'],
      defaultId: 0
    })
    if (response === 0 && recent) {
      await recent.remove(path)
      recentFilesChanged()
    }
  }
}

function openRecentMenu(): Electron.MenuItemConstructorOptions {
  const files = recent ? describeRecent(recent.entries) : []
  const items: Electron.MenuItemConstructorOptions[] = files.map((file, i) => ({
    // Ampersands would become mnemonics; escape them.
    label: `${i + 1}. ${file.name.replace(/&/g, '&&')}${file.exists ? '' : '  (not found)'}`,
    sublabel: file.folder,
    toolTip: file.path,
    accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
    click: () => void openRecentFromMenu(file.path)
  }))
  return {
    label: 'Open Recent',
    submenu: [
      ...(items.length > 0 ? items : [{ label: 'No recent files', enabled: false }]),
      { type: 'separator' },
      {
        label: 'Clear Recently Opened',
        enabled: items.length > 0,
        click: async () => {
          await recent?.clear()
          app.clearRecentDocuments()
          recentFilesChanged()
        }
      }
    ]
  }
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
  const settings: Electron.MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => sendMenuCommand('open-settings')
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS: the app menu holds About, Settings and Quit.
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ] satisfies Electron.MenuItemConstructorOptions[]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open MIDI…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCommand('open-midi')
        },
        openRecentMenu(),
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
        ...(isMac
          ? [{ type: 'separator' }, { role: 'close' }] satisfies Electron.MenuItemConstructorOptions[]
          : ([
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'quit' }
            ] satisfies Electron.MenuItemConstructorOptions[]))
      ]
    },
    // macOS only routes copy, paste and undo shortcuts in text fields through an Edit menu.
    ...(isMac ? [{ role: 'editMenu' } satisfies Electron.MenuItemConstructorOptions] : []),
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    ...(isMac ? [{ role: 'windowMenu' } satisfies Electron.MenuItemConstructorOptions] : [])
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

  ipcMain.handle(IpcChannels.getRecentFiles, () => (recent ? describeRecent(recent.entries) : []))
  ipcMain.handle(IpcChannels.openRecentFile, (_event, path: string) => {
    // Only paths the app itself put on the list.
    if (!recent?.has(path)) throw new Error('Not a recently opened file')
    return loadMidiFile(path)
  })
  ipcMain.handle(IpcChannels.removeRecentFile, async (_event, path: string) => {
    await recent?.remove(path)
    recentFilesChanged()
  })
  ipcMain.handle(IpcChannels.clearRecentFiles, async () => {
    await recent?.clear()
    app.clearRecentDocuments()
    recentFilesChanged()
  })

  // The renderer asks once on startup for a file the app was launched with.
  ipcMain.handle(IpcChannels.takeLaunchFile, async () => {
    rendererListening = true
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

  ipcMain.handle(IpcChannels.setNativeTheme, (_event, mode: string) => {
    if (mode === 'system' || mode === 'light' || mode === 'dark') nativeTheme.themeSource = mode
  })

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
  rendererListening = false
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Buzzz Midi Player',
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

/** Opens a file the system handed to the running app (Explorer, Finder, file manager). */
async function openFromSystem(path: string): Promise<void> {
  if (!mainWindow || !rendererListening) {
    // The page picks it up as its launch file once it has loaded.
    launchPath = path
    if (app.isReady() && !mainWindow) createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  try {
    mainWindow.webContents.send(IpcChannels.openFile, await loadMidiFile(path))
  } catch (err) {
    dialog.showErrorBox('Could not open file', err instanceof Error ? err.message : String(err))
  }
}

// macOS hands over files (double-clicked in Finder, dropped on the Dock icon) with this event,
// also at launch, before the app is ready.
app.on('open-file', (event, path) => {
  event.preventDefault()
  void openFromSystem(path)
})

migrateUserData()

// One window: opening another MIDI file from Explorer loads it into the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = midiPathFromArgs(argv)
    if (path) void openFromSystem(path)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    recent = new RecentFilesStore(join(app.getPath('userData'), 'recent-files.json'))
    await recent.load()
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
