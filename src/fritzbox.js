'use strict';

/**
 * FRITZ!Box TR-064 Client (ohne externe Abhaengigkeiten).
 *
 * Voraussetzungen an der Fritz!Box:
 *  - "Heimnetz > Netzwerk > Netzwerkeinstellungen > Zugriff fuer Anwendungen zulassen" aktiv
 *  - ein FRITZ!Box-Benutzer mit Passwort (Benutzername + Passwort in den Einstellungen)
 *
 * Genutzt:
 *  - X_AVM-DE_OnTel:GetCallList   -> Anrufliste (Verlauf)
 *  - X_AVM-DE_OnTel:GetMessageList -> Anrufbeantworter-Nachrichten
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const ONTEL = {
  uri: '/upnp/control/x_contact',
  serviceType: 'urn:dslforum-org:service:X_AVM-DE_OnTel:1',
};

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function parseDigest(header) {
  const out = {};
  (header || '').replace(/(\w+)=(?:"([^"]*)"|([^\s,]*))/g, (m, k, q, u) => {
    out[k] = q !== undefined ? q : u;
    return m;
  });
  return out;
}

function digestHeader({ username, password, method, uri, wwwAuth }) {
  const d = parseDigest(wwwAuth);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${username}:${d.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = d.qop
    ? md5(`${ha1}:${d.nonce}:${nc}:${cnonce}:${d.qop}:${ha2}`)
    : md5(`${ha1}:${d.nonce}:${ha2}`);
  let h = `Digest username="${username}", realm="${d.realm}", nonce="${d.nonce}", uri="${uri}", response="${response}"`;
  if (d.qop) h += `, qop=${d.qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (d.opaque) h += `, opaque="${d.opaque}"`;
  return h;
}

function tag(xml, name) {
  const m = (xml || '').match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** GET (Text), https mit selbstsigniertem Zertifikat erlaubt. */
function getText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = u.protocol === 'https:' ? { rejectUnauthorized: false } : {};
    mod
      .get(url, opts, (res) => {
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });
}

/** GET (Binaer) -> Buffer. */
function getBinary(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = u.protocol === 'https:' ? { rejectUnauthorized: false } : {};
    mod
      .get(url, opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function soapCall(cfg, { action, args = {} }) {
  if (!cfg.host) throw new Error('Fritz!Box-Host fehlt');
  if (!cfg.username || !cfg.password) throw new Error('Fritz!Box-Benutzer/Passwort fehlt (Einstellungen)');

  const port = cfg.tr064Port || 49000;
  const url = `http://${cfg.host}:${port}${ONTEL.uri}`;
  const argXml = Object.entries(args)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${ONTEL.serviceType}">${argXml}</u:${action}></s:Body></s:Envelope>`;

  const headers = {
    'Content-Type': 'text/xml; charset="utf-8"',
    SOAPAction: `${ONTEL.serviceType}#${action}`,
  };

  let res = await fetch(url, { method: 'POST', headers, body });
  if (res.status === 401) {
    const auth = digestHeader({
      username: cfg.username,
      password: cfg.password,
      method: 'POST',
      uri: ONTEL.uri,
      wwwAuth: res.headers.get('www-authenticate'),
    });
    res = await fetch(url, { method: 'POST', headers: { ...headers, Authorization: auth }, body });
  }
  const text = await res.text();
  if (res.status === 401) throw new Error('Anmeldung fehlgeschlagen (Benutzer/Passwort?)');
  if (!res.ok) throw new Error(`TR-064 ${action}: HTTP ${res.status}`);
  return text;
}

// ---- Anrufliste ----
function parseCallList(xml) {
  const calls = [];
  const re = /<Call>([\s\S]*?)<\/Call>/g;
  let m;
  while ((m = re.exec(xml))) {
    const c = m[1];
    calls.push({
      id: tag(c, 'Id'),
      type: parseInt(tag(c, 'Type') || '0', 10),
      caller: (tag(c, 'Caller') || '').trim(),
      called: (tag(c, 'Called') || '').trim(),
      name: decodeEntities((tag(c, 'Name') || '').trim()),
      date: (tag(c, 'Date') || '').trim(),
      duration: (tag(c, 'Duration') || '').trim(),
      device: decodeEntities((tag(c, 'Device') || '').trim()),
    });
  }
  return calls;
}

async function getCallList(cfg, days = 14) {
  const xml = await soapCall(cfg, { action: 'GetCallList' });
  let listUrl = decodeEntities(tag(xml, 'NewCallListURL') || '');
  if (!listUrl) throw new Error('keine CallList-URL erhalten');
  if (!/[?&](days|max)=/.test(listUrl)) {
    listUrl += (listUrl.includes('?') ? '&' : '?') + `days=${days}`;
  }
  return parseCallList(await getText(listUrl));
}

// ---- Anrufbeantworter ----
function parseMessages(xml) {
  const out = [];
  const re = /<Message>([\s\S]*?)<\/Message>/g;
  let m;
  while ((m = re.exec(xml))) {
    const x = m[1];
    out.push({
      index: tag(x, 'Index'),
      isNew: tag(x, 'New') === '1',
      name: decodeEntities((tag(x, 'Name') || '').trim()),
      number: (tag(x, 'Number') || '').trim(),
      date: (tag(x, 'Date') || '').trim(),
      duration: (tag(x, 'Duration') || '').trim(),
      path: (tag(x, 'Path') || '').trim(),
    });
  }
  return out;
}

async function messagesUrl(cfg, tamIndex = 0) {
  const xml = await soapCall(cfg, { action: 'GetMessageList', args: { NewIndex: tamIndex } });
  const url = decodeEntities(tag(xml, 'NewURL') || '');
  if (!url) throw new Error('keine MessageList-URL (Anrufbeantworter aktiv?)');
  return url;
}

async function getMessages(cfg, tamIndex = 0) {
  const url = await messagesUrl(cfg, tamIndex);
  return parseMessages(await getText(url));
}

/** Best-effort: Audio-Download-URL aus MessageList-URL (sid) + Message-Path bauen. */
function audioUrl(baseUrl, msgPath) {
  const u = new URL(baseUrl);
  const sid = u.searchParams.get('sid');
  let p = /^https?:/i.test(msgPath)
    ? msgPath
    : `${u.protocol}//${u.host}${msgPath.startsWith('/') ? '' : '/'}${msgPath}`;
  if (sid && !/[?&]sid=/.test(p)) p += (p.includes('?') ? '&' : '?') + 'sid=' + sid;
  return p;
}

/** Nachricht herunterladen, in Temp-WAV schreiben, Pfad zurueckgeben. */
async function downloadMessage(cfg, msg, tamIndex = 0) {
  const base = await messagesUrl(cfg, tamIndex);
  const buf = await getBinary(audioUrl(base, msg.path));
  const tmp = path.join(os.tmpdir(), `fritz-ab-${msg.index || 'msg'}.wav`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

module.exports = { getCallList, getMessages, downloadMessage };
