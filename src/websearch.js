'use strict';

/**
 * Generische Web-Suche ueber einen lokal laufenden SearXNG-Dienst.
 * SearXNG aggregiert mehrere Suchmaschinen (Google, Bing, DuckDuckGo ...)
 * und liefert die Treffer als JSON zurueck – kein API-Key, alles lokal.
 *
 * Voraussetzung: SearXNG laeuft (siehe docker/ im Projekt) und hat das
 * JSON-Ausgabeformat aktiviert (search.formats: [html, json]).
 */

const { nationalDE } = require('./util');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Sucht nach einer Telefonnummer und gibt die Top-Treffer zurueck.
 * Es wird sowohl die nationale (0...) als auch die internationale (+49...)
 * Schreibweise abgefragt, da Eintraege mal so, mal so indexiert sind.
 *
 * @returns {Promise<Array<{title:string,url:string,content:string,engine:string}>>}
 */
async function webSearch(number, { searxngUrl, maxResults } = {}) {
  const base = (searxngUrl || 'http://localhost:8888').replace(/\/+$/, '');
  const max = Math.max(1, maxResults || 10);

  const nat = nationalDE(number);
  // Beide Schreibweisen in Anfuehrungszeichen, mit ODER verknuepft.
  const q = nat && nat !== number ? `"${nat}" OR "${number}"` : `"${number}"`;

  const params = new URLSearchParams({
    q,
    format: 'json',
    language: 'de-DE',
    safesearch: '0',
  });

  const url = `${base}/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('SearXNG: JSON-Format nicht erlaubt (search.formats in settings.yml pruefen)');
    }
    throw new Error(`SearXNG HTTP ${res.status}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    throw new Error('SearXNG lieferte kein JSON (laeuft der Dienst? JSON aktiviert?)');
  }

  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];

  return results.slice(0, max).map((r) => ({
    title: (r.title || '').trim(),
    url: r.url || '',
    content: (r.content || '').trim(),
    engine: r.engine || '',
  }));
}

module.exports = { webSearch };
