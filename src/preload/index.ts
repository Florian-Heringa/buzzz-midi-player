import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, type ElectronApi, type MenuCommand } from '../shared/api'

const api: ElectronApi = {
  openMidiDialog: () => ipcRenderer.invoke(IpcChannels.openMidiDialog),
  readMidiFile: (path) => ipcRenderer.invoke(IpcChannels.readMidiFile, path),
  loadSoundFont: () => ipcRenderer.invoke(IpcChannels.loadSoundFont),
  readAutoPreset: (hash) => ipcRenderer.invoke(IpcChannels.readAutoPreset, hash),
  writeAutoPreset: (hash, preset) => ipcRenderer.invoke(IpcChannels.writeAutoPreset, hash, preset),
  savePresetDialog: (preset, defaultName) =>
    ipcRenderer.invoke(IpcChannels.savePresetDialog, preset, defaultName),
  openPresetDialog: () => ipcRenderer.invoke(IpcChannels.openPresetDialog),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand): void =>
      listener(command)
    ipcRenderer.on(IpcChannels.menuCommand, handler)
    return () => ipcRenderer.removeListener(IpcChannels.menuCommand, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
