'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Live-Monitor
  onStatus: (cb) => ipcRenderer.on('monitor:status', (_e, d) => cb(d)),
  onCall: (cb) => ipcRenderer.on('call:event', (_e, d) => cb(d)),
  onLookup: (cb) => ipcRenderer.on('call:lookup', (_e, d) => cb(d)),
  manualLookup: (n) => ipcRenderer.invoke('lookup:manual', n),

  // Einstellungen
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),

  // Kontakte / Markierungen
  getContact: (n) => ipcRenderer.invoke('contacts:get', n),
  allContacts: () => ipcRenderer.invoke('contacts:all'),
  saveContact: (number, data) => ipcRenderer.invoke('contacts:save', { number, data }),
  deleteContact: (n) => ipcRenderer.invoke('contacts:delete', n),

  // Fritz!Box: Verlauf + AB-Aufnahmen
  callList: () => ipcRenderer.invoke('fritz:calllist'),
  playRecording: (recPath) => ipcRenderer.invoke('fritz:playRecording', recPath),

  openExternal: (u) => ipcRenderer.invoke('open:external', u),
});
