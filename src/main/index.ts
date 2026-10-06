import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { readFile } from 'fs/promises'
import { basename, join } from 'path'
import { IpcChannels, type LoadedMidiFile, type MenuCommand } from '../shared/api'

const MIDI_FILTERS = [{ name: 'MIDI files', extensions: ['mid', 'midi'] }]
const SOUNDFONT_FILE = 'GeneralUser-GS.sf2'

let mainWindow: BrowserWindow | null = null

async function loadMidiFile(path: string): Promise<LoadedMidiFile> {
  const buffer = await readFile(path)
  return { name: basename(path), path, data: new Uint8Array(buffer) }
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

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
