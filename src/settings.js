'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // port = Call-Monitor (1012); tr064Port = TR-064 fuer Verlauf/AB (49000);
  // username/password = FRITZ!Box-Benutzer fuer TR-064.
  fritzbox: { host: 'fritz.box', port: 1012, tr064Port: 49000, username: '', password: '' },
  // tellows-API: Partner-Account auf https://www.tellows.de/c/partner/ anlegen
  // und eigenen Key eintragen. Die Test-Credentials sind oft stark limitiert.
  tellows: { partner: 'test', apikey: 'test123' },
  // Optionale LLM-Einschaetzung (leer = aus). Anthropic-API-Key eintragen.
  llm: { apiKey: '', model: 'claude-haiku-4-5' },
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override || {})) {
    const ov = override[key];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && typeof out[key] === 'object') {
      out[key] = deepMerge(out[key], ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return deepMerge(DEFAULTS, {});
  }
}

function saveSettings(next) {
  const merged = deepMerge(DEFAULTS, next);
  fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { loadSettings, saveSettings, DEFAULTS };
