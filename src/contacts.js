'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { normalize } = require('./util');

/**
 * Lokaler Kontakt-/Markierungs-Speicher (contacts.json in userData).
 * Pro Nummer: Name, Kategorie (eigene Einstufung) und Notiz.
 */

function file() {
  return path.join(app.getPath('userData'), 'contacts.json');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

function persist(map) {
  fs.writeFileSync(file(), JSON.stringify(map, null, 2), 'utf8');
}

function getContact(number) {
  const key = normalize(number);
  if (!key) return null;
  return load()[key] || null;
}

function getAll() {
  return load();
}

function saveContact(number, data) {
  const key = normalize(number);
  if (!key) return null;
  const map = load();
  map[key] = {
    number: key,
    name: (data && data.name) || '',
    category: (data && data.category) || '',
    note: (data && data.note) || '',
    updatedAt: Date.now(),
  };
  persist(map);
  return map[key];
}

function deleteContact(number) {
  const key = normalize(number);
  const map = load();
  delete map[key];
  persist(map);
  return true;
}

module.exports = { getContact, getAll, saveContact, deleteContact };
