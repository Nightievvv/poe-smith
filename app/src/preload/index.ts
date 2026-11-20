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
  getPriceCheck: () => ipcRenderer.invoke('pc:get'),
  pcSearch: (item, filters) => ipcRenderer.invoke('pc:search', item, filters),
  pcMore: (item, queryId, ids) => ipcRenderer.invoke('pc:more', item, queryId, ids),
  closePriceCheck: () => ipcRenderer.send('pc:close'),
  craftPlan: (item, targets, lang, opts) => ipcRenderer.invoke('craft:plan', item, targets, lang, opts),
  currencyIcons: (ids) => ipcRenderer.invoke('icons:currency', ids),
  craftDataStatus: () => ipcRenderer.invoke('craft:status'),
  estimateValue: (item) => ipcRenderer.invoke('craft:value', item),
  checkFavorites: () => ipcRenderer.invoke('watcher:check'),
  journalList: () => ipcRenderer.invoke('journal:list'),
  journalAdd: (e) => ipcRenderer.invoke('journal:add', e),
  journalUpdate: (id, patch) => ipcRenderer.invoke('journal:update', id, patch),
  journalRemove: (id) => ipcRenderer.invoke('journal:remove', id),
  saveProfile: (item, filters, name) => ipcRenderer.invoke('profile:save', item, filters, name),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  openHarvestFile: () => ipcRenderer.invoke('harvest:open'),
  resetHarvestFile: () => ipcRenderer.invoke('harvest:reset'),
  openInCraft: (item) => ipcRenderer.send('craft:open', item),
  hide: () => ipcRenderer.send('overlay:hide'),
  exchange: (force) => ipcRenderer.invoke('exchange:get', force),
  exchangeIcons: (ids) => ipcRenderer.invoke('exchange:icons', ids),
  stashClose: () => ipcRenderer.send('stash:close'),
  mapMods: () => ipcRenderer.invoke('maps:mods'),
  itemBases: () => ipcRenderer.invoke('items:bases'),
  itemMods: (base) => ipcRenderer.invoke('items:mods', base),
  craftAddable: (item) => ipcRenderer.invoke('craft:addable', item),
  updateState: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onEvent: (cb) => {
    const h = (_: unknown, e: OverlayEvent) => cb(e)
    ipcRenderer.on('overlay:event', h)
    return () => ipcRenderer.removeListener('overlay:event', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
if (process.env.POESMITH_DEBUG || process.env.EXILE_FORGE_DEBUG)
  contextBridge.exposeInMainWorld('debug', { item: (text: string, mode: 'read' | 'price') => ipcRenderer.invoke('debug:item', text, mode), stash: (path: string) => ipcRenderer.invoke('debug:stash', path), stashLive: () => ipcRenderer.invoke('debug:stashLive') })
