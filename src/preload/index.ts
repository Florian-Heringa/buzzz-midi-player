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
  exportMp3: (request) => ipcRenderer.invoke(IpcChannels.exportMp3, request),
  cancelExport: () => ipcRenderer.invoke(IpcChannels.cancelExport),
  onExportProgress: (listener) => subscribe(IpcChannels.exportProgress, listener),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuCommand: (listener) => subscribe<MenuCommand>(IpcChannels.menuCommand, listener)
}

/** Forwards messages on a channel to a listener; returns an unsubscribe function. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', api)
