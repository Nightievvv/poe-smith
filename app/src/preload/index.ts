import { contextBridge, ipcRenderer } from 'electron'
import type { Api, OverlayEvent } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getLeagues: () => ipcRenderer.invoke('leagues:get'),
  hasSession: () => ipcRenderer.invoke('session:has'),
  setSession: (v) => ipcRenderer.invoke('session:set', v),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  suspendHotkeys: (s) => ipcRenderer.invoke('hotkeys:suspend', s),
  getMarket: (q) => ipcRenderer.invoke('market:get', q),
  scanMarket: (q, more) => ipcRenderer.invoke('market:scan', q, more),
  getDivine: () => ipcRenderer.invoke('rates:divine'),
  getLimits: () => ipcRenderer.invoke('limits:get'),
  hide: () => ipcRenderer.send('overlay:hide'),
  onEvent: (cb) => {
    const h = (_: unknown, e: OverlayEvent) => cb(e)
    ipcRenderer.on('overlay:event', h)
    return () => ipcRenderer.removeListener('overlay:event', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
