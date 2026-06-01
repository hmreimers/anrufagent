'use strict';

// ---- Einstufungen (eigene Markierungen) ----
const CATEGORIES = [
  { key: '', label: '– keine –', level: 'unknown' },
  { key: 'serioes', label: 'Seriös / Bekannt', level: 'good' },
  { key: 'wichtig', label: 'Wichtig', level: 'info' },
  { key: 'neutral', label: 'Neutral', level: 'unknown' },
  { key: 'werbung', label: 'Werbung', level: 'warn' },
  { key: 'verdaechtig', label: 'Verdächtig', level: 'warn' },
  { key: 'spam', label: 'Spam / Blockieren', level: 'bad' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nowTime() {
  return new Date().toLocaleTimeString('de-DE');
}
function todayStr() {
  // tellows/Fritz-Format: dd.MM.yy
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

// ---- Tabs ----
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('view-' + tab.dataset.tab).classList.add('active');
  });
});

// =====================================================================
// LIVE
// =====================================================================
const calls = document.getElementById('calls');
const emptyState = document.getElementById('emptyState');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const cards = new Map();

function setStatus(s) {
  if (s.connecting) {
    statusDot.className = 'dot wait';
    statusText.textContent = `verbinde mit ${s.host}…`;
  } else if (s.connected) {
    statusDot.className = 'dot on';
    statusText.textContent = `verbunden (${s.host}:${s.port})`;
  } else {
    statusDot.className = 'dot off';
    statusText.textContent = s.error ? `getrennt: ${s.error}` : 'getrennt';
  }
}

function ensureCard(id) {
  if (cards.has(id)) return cards.get(id);
  if (emptyState) emptyState.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'card fresh';
  calls.prepend(el);
  cards.set(id, el);
  setTimeout(() => el.classList.remove('fresh'), 4000);
  return el;
}

function contactBadge(contact) {
  if (!contact || !contact.category) return '';
  const c = CAT[contact.category] || { label: contact.category, level: 'unknown' };
  return `<span class="badge ${c.level}">${escapeHtml(c.label)}</span>`;
}

function renderCard(el, { number, called, time, lookup }) {
  const contact = lookup && lookup.contact;
  const displayName = contact && contact.name ? contact.name : null;

  let html = `
    <div class="row">
      <span class="number">${escapeHtml(displayName || number || 'Unterdrueckt')}</span>
      <span class="time">${escapeHtml(time)}</span>
    </div>`;
  if (displayName) html += `<div class="called">${escapeHtml(number)}</div>`;
  if (called) html += `<div class="called">an: ${escapeHtml(called)}</div>`;
  if (contact && contact.category) html += `<div class="row" style="margin-top:6px">${contactBadge(contact)}</div>`;
  if (contact && contact.note) html += `<div class="called">${escapeHtml(contact.note)}</div>`;

  if (lookup === 'pending') {
    html += `<div class="spinner">recherchiere Anrufer…</div>`;
  } else if (lookup && lookup.suppressed) {
    html += `<div class="meta"><span>Nummer unterdrueckt</span></div>`;
  } else if (lookup) {
    const t = lookup.tellows;
    if (t) {
      const lvl = (t.label && t.label.level) || 'unknown';
      const lblText = (t.label && t.label.text) || 'unbekannt';
      const scoreTxt = t.score != null ? `tellows ${t.score}/9` : 'kein tellows-Score';
      html += `<div class="row" style="margin-top:10px">
        <span class="badge ${lvl}">${escapeHtml(lblText)}</span>
        <span class="time">${escapeHtml(scoreTxt)}</span>
      </div>`;
      const meta = [];
      if (t.location) meta.push(escapeHtml(t.location));
      if (t.comments) meta.push(`${t.comments} Bewertung(en)`);
      if (meta.length) html += `<div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>`;
      if (t.types && t.types.length) {
        html += `<div class="types">` +
          t.types.map((x) => `<span class="chip">${escapeHtml(x.name)} &middot; ${x.count}</span>`).join('') + `</div>`;
      }
    } else if (lookup.tellowsError) {
      html += `<div class="err">tellows: ${escapeHtml(lookup.tellowsError)}</div>`;
    }
    if (lookup.verdict) html += `<div class="verdict">${escapeHtml(lookup.verdict)}</div>`;
    else if (lookup.verdictError) html += `<div class="err">LLM: ${escapeHtml(lookup.verdictError)}</div>`;

    const num = (lookup.number || number) || '';
    html += `<div class="links">
      <a data-edit="${escapeHtml(num)}">${contact ? '✎ markieren/bearbeiten' : '✎ markieren'}</a>
      <a data-url="https://www.tellows.de/num/${encodeURIComponent(num)}">tellows &#8599;</a>
      <a data-url="https://www.google.com/search?q=${encodeURIComponent('"' + num + '"')}">Google &#8599;</a>
    </div>`;
  }

  el.innerHTML = html;
  el.querySelectorAll('a[data-url]').forEach((a) =>
    a.addEventListener('click', () => window.api.openExternal(a.dataset.url)));
  el.querySelectorAll('a[data-edit]').forEach((a) =>
    a.addEventListener('click', () => openEditor(a.dataset.edit)));
}

window.api.onStatus(setStatus);

window.api.onCall((event) => {
  if (event.type === 'RING') {
    const el = ensureCard(event.connectionId);
    el.dataset.number = event.caller;
    el.dataset.called = event.called || '';
    el.dataset.time = nowTime();
    renderCard(el, { number: event.caller, called: event.called, time: el.dataset.time, lookup: 'pending' });
  } else if (event.type === 'CONNECT') {
    const el = cards.get(event.connectionId);
    if (el) el.style.opacity = '0.75';
  } else if (event.type === 'DISCONNECT') {
    const el = cards.get(event.connectionId);
    if (el) el.style.opacity = '0.55';
  }
});

window.api.onLookup(({ connectionId, info }) => {
  const el = cards.get(connectionId);
  if (!el) return;
  el._lookup = info;
  renderCard(el, { number: el.dataset.number, called: el.dataset.called, time: el.dataset.time, lookup: info });
});

// Manuelle Pruefung
const manualInput = document.getElementById('manualInput');
const manualBtn = document.getElementById('manualBtn');
async function runManual() {
  const num = manualInput.value.trim();
  if (!num) return;
  const id = 'manual-' + num + '-' + nowTime();
  const el = ensureCard(id);
  el.dataset.number = num;
  el.dataset.called = '';
  el.dataset.time = nowTime();
  renderCard(el, { number: num, time: el.dataset.time, lookup: 'pending' });
  const info = await window.api.manualLookup(num);
  el._lookup = info;
  renderCard(el, { number: num, time: el.dataset.time, lookup: info });
}
manualBtn.addEventListener('click', runManual);
manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runManual(); });

// =====================================================================
// VERLAUF
// =====================================================================
const callListEl = document.getElementById('callList');
const onlyToday = document.getElementById('onlyToday');
let lastCalls = [];

const CALL_TYPE = {
  1: { ico: '↙', txt: 'eingehend', cls: '' },
  2: { ico: '✕', txt: 'verpasst', cls: 'missed' },
  3: { ico: '↗', txt: 'ausgehend', cls: '' },
  9: { ico: '↙', txt: 'aktiv', cls: '' },
  10: { ico: '⛔', txt: 'blockiert', cls: 'missed' },
};

function renderCalls() {
  let list = lastCalls;
  if (onlyToday.checked) {
    const t = todayStr();
    list = list.filter((c) => (c.date || '').startsWith(t));
  }
  if (!list.length) {
    callListEl.innerHTML = `<p class="empty">Keine Anrufe${onlyToday.checked ? ' heute' : ''}.</p>`;
    return;
  }
  callListEl.innerHTML = '';
  for (const c of list) {
    const meta = CALL_TYPE[c.type] || { ico: '•', txt: 'Anruf', cls: '' };
    const num = c.type === 3 ? c.called : c.caller;
    const name = (c.contact && c.contact.name) || c.name || '';
    const el = document.createElement('div');
    el.className = `item ${meta.cls}`;
    el.innerHTML = `
      <span class="ico">${meta.ico}</span>
      <div class="body">
        <div class="title">${escapeHtml(name || num || 'Unbekannt')} ${contactBadge(c.contact)}</div>
        <div class="sub">${escapeHtml(num)} &middot; ${escapeHtml(meta.txt)} &middot; ${escapeHtml(c.date)}${c.duration && c.duration !== '0:00' ? ' &middot; ' + escapeHtml(c.duration) : ''}</div>
      </div>
      <button class="edit-btn" title="markieren">✎</button>`;
    el.querySelector('.edit-btn').addEventListener('click', () => openEditor(num));
    callListEl.appendChild(el);
  }
}

async function loadCalls() {
  callListEl.innerHTML = `<p class="empty">lade Verlauf…</p>`;
  const res = await window.api.callList();
  if (!res.ok) {
    callListEl.innerHTML = `<p class="empty err">Fehler: ${escapeHtml(res.error)}</p>`;
    return;
  }
  lastCalls = res.calls;
  renderCalls();
}
document.getElementById('reloadCalls').addEventListener('click', loadCalls);
onlyToday.addEventListener('change', renderCalls);

// =====================================================================
// ANRUFBEANTWORTER
// =====================================================================
const msgListEl = document.getElementById('msgList');
const player = document.getElementById('player');

async function loadMessages() {
  msgListEl.innerHTML = `<p class="empty">lade Nachrichten…</p>`;
  const res = await window.api.messages();
  if (!res.ok) {
    msgListEl.innerHTML = `<p class="empty err">Fehler: ${escapeHtml(res.error)}</p>`;
    return;
  }
  if (!res.messages.length) {
    msgListEl.innerHTML = `<p class="empty">Keine Nachrichten.</p>`;
    return;
  }
  msgListEl.innerHTML = '';
  for (const m of res.messages) {
    const name = (m.contact && m.contact.name) || m.name || m.number || 'Unbekannt';
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <span class="ico">☎</span>
      <div class="body">
        <div class="title">${escapeHtml(name)} ${m.isNew ? '<span class="tag-new">NEU</span>' : ''} ${contactBadge(m.contact)}</div>
        <div class="sub">${escapeHtml(m.number)} &middot; ${escapeHtml(m.date)} &middot; ${escapeHtml(m.duration)}</div>
      </div>
      <div class="actions">
        <button class="mini play">▶ Abspielen</button>
        <button class="edit-btn" title="markieren">✎</button>
      </div>`;
    el.querySelector('.play').addEventListener('click', async (ev) => {
      ev.target.textContent = '… lade';
      const r = await window.api.playMessage(m);
      if (!r.ok) { ev.target.textContent = 'Fehler'; alert('Wiedergabe fehlgeschlagen: ' + r.error); return; }
      player.src = 'file:///' + r.file.replace(/\\/g, '/');
      player.classList.remove('hidden');
      player.play().catch(() => {});
      ev.target.textContent = '▶ Abspielen';
    });
    el.querySelector('.edit-btn').addEventListener('click', () => openEditor(m.number));
    msgListEl.appendChild(el);
  }
}
document.getElementById('reloadMsgs').addEventListener('click', loadMessages);

// =====================================================================
// KONTAKT-EDITOR
// =====================================================================
const contactPanel = document.getElementById('contactPanel');
const cNumber = document.getElementById('cNumber');
const cName = document.getElementById('cName');
const cCategory = document.getElementById('cCategory');
const cNote = document.getElementById('cNote');

cCategory.innerHTML = CATEGORIES.map((c) => `<option value="${c.key}">${c.label}</option>`).join('');

async function openEditor(number) {
  if (!number) return;
  const existing = await window.api.getContact(number);
  cNumber.value = number;
  cName.value = (existing && existing.name) || '';
  cCategory.value = (existing && existing.category) || '';
  cNote.value = (existing && existing.note) || '';
  contactPanel.classList.remove('hidden');
}
function closeEditor() { contactPanel.classList.add('hidden'); }

document.getElementById('cCancel').addEventListener('click', closeEditor);
document.getElementById('cSave').addEventListener('click', async () => {
  await window.api.saveContact(cNumber.value, {
    name: cName.value.trim(),
    category: cCategory.value,
    note: cNote.value.trim(),
  });
  closeEditor();
  await refreshAfterContactChange();
});
document.getElementById('cDelete').addEventListener('click', async () => {
  await window.api.deleteContact(cNumber.value);
  closeEditor();
  await refreshAfterContactChange();
});

async function refreshAfterContactChange() {
  // Live-Karten neu auswerten (Kontakt neu ziehen)
  for (const [, el] of cards) {
    if (!el.dataset.number) continue;
    const contact = await window.api.getContact(el.dataset.number);
    if (el._lookup) { el._lookup.contact = contact; renderCard(el, { number: el.dataset.number, called: el.dataset.called, time: el.dataset.time, lookup: el._lookup }); }
  }
  if (document.getElementById('view-verlauf').classList.contains('active')) loadCalls();
}

// =====================================================================
// EINSTELLUNGEN
// =====================================================================
const panel = document.getElementById('settingsPanel');
document.getElementById('settingsBtn').addEventListener('click', async () => {
  const s = await window.api.getSettings();
  document.getElementById('setHost').value = s.fritzbox.host;
  document.getElementById('setPort').value = s.fritzbox.port;
  document.getElementById('setTr064').value = s.fritzbox.tr064Port;
  document.getElementById('setUser').value = s.fritzbox.username;
  document.getElementById('setPass').value = s.fritzbox.password;
  document.getElementById('setPartner').value = s.tellows.partner;
  document.getElementById('setApikey').value = s.tellows.apikey;
  document.getElementById('setLlmKey').value = s.llm.apiKey;
  document.getElementById('setLlmModel').value = s.llm.model;
  panel.classList.remove('hidden');
});
document.getElementById('cancelSettings').addEventListener('click', () => panel.classList.add('hidden'));
document.getElementById('saveSettings').addEventListener('click', async () => {
  await window.api.setSettings({
    fritzbox: {
      host: document.getElementById('setHost').value.trim() || 'fritz.box',
      port: parseInt(document.getElementById('setPort').value, 10) || 1012,
      tr064Port: parseInt(document.getElementById('setTr064').value, 10) || 49000,
      username: document.getElementById('setUser').value.trim(),
      password: document.getElementById('setPass').value,
    },
    tellows: {
      partner: document.getElementById('setPartner').value.trim(),
      apikey: document.getElementById('setApikey').value.trim(),
    },
    llm: {
      apiKey: document.getElementById('setLlmKey').value.trim(),
      model: document.getElementById('setLlmModel').value.trim() || 'claude-haiku-4-5',
    },
  });
  panel.classList.add('hidden');
});
