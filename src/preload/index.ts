import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, type ElectronApi, type MenuCommand } from '../shared/api'

const api: ElectronApi = {
  openMidiDialog: () => ipcRenderer.invoke(IpcChannels.openMidiDialog),
  readMidiFile: (path) => ipcRenderer.invoke(IpcChannels.readMidiFile, path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand): void =>
      listener(command)
    ipcRenderer.on(IpcChannels.menuCommand, handler)
    return () => ipcRenderer.removeListener(IpcChannels.menuCommand, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
