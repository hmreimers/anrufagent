'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { CallMonitor } = require('./src/callmonitor');
const { lookupCaller } = require('./src/lookup');
const { loadSettings, saveSettings } = require('./src/settings');
const contacts = require('./src/contacts');
const fritz = require('./src/fritzbox');

let win = null;
let monitor = null;
let settings = null;

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 380,
    title: 'Anrufagent',
    backgroundColor: '#11141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startMonitor() {
  if (monitor) monitor.stop();
  monitor = new CallMonitor({
    host: settings.fritzbox.host,
    port: settings.fritzbox.port,
  });

  monitor.on('status', (s) => send('monitor:status', s));

  monitor.on('call', async (event) => {
    send('call:event', event);

    if (event.type === 'RING' && event.caller) {
      try {
        const info = await lookupCaller(event.caller, settings);
        send('call:lookup', { connectionId: event.connectionId, info });

        if (Notification.isSupported()) {
          const label = info.tellows && info.tellows.label;
          const body = label && label.text ? `Einschaetzung: ${label.text}` : 'Eingehender Anruf';
          new Notification({ title: `Anruf von ${event.caller}`, body }).show();
        }
      } catch (e) {
        send('call:lookup', { connectionId: event.connectionId, info: { error: e.message } });
      }
    }
  });

  monitor.start();
}

app.whenReady().then(() => {
  settings = loadSettings();
  createWindow();
  win.webContents.once('did-finish-load', startMonitor);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:set', (_e, next) => {
  settings = saveSettings(next);
  startMonitor();
  return settings;
});

ipcMain.handle('lookup:manual', (_e, number) => lookupCaller(number, settings));

ipcMain.handle('open:external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ---- Kontakte / Markierungen ----
ipcMain.handle('contacts:get', (_e, number) => contacts.getContact(number));
ipcMain.handle('contacts:all', () => contacts.getAll());
ipcMain.handle('contacts:save', (_e, { number, data }) => contacts.saveContact(number, data));
ipcMain.handle('contacts:delete', (_e, number) => contacts.deleteContact(number));

// ---- Fritz!Box TR-064: Verlauf + Anrufbeantworter ----
ipcMain.handle('fritz:calllist', async () => {
  try {
    const calls = await fritz.getCallList(settings.fritzbox);
    // eigene Markierungen anreichern
    for (const c of calls) {
      const num = c.type === 3 ? c.called : c.caller;
      c.contact = contacts.getContact(num);
    }
    return { ok: true, calls };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('fritz:messages', async () => {
  try {
    const messages = await fritz.getMessages(settings.fritzbox);
    for (const m of messages) m.contact = contacts.getContact(m.number);
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('fritz:playMessage', async (_e, msg) => {
  try {
    return { ok: true, file: await fritz.downloadMessage(settings.fritzbox, msg) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
