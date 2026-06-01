'use strict';

/**
 * Anrufer-Recherche:
 *  1) tellows (Werbeanruf-/Spam-Meldeseite)
 *     - mit echtem Partner-Key: offizielle JSON-API
 *     - ohne Key: Scraping der oeffentlichen Nummern-Seite (Score + Ort)
 *  2) optionale LLM-Einschaetzung (Anthropic) auf Basis der tellows-Daten
 *
 * Es werden ausschliesslich oeffentliche Daten abgefragt; alles laeuft lokal.
 */

const { normalize, nationalDE } = require('./util');
const { getContact } = require('./contacts');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** tellows-Score (1-9) in eine grobe Ampel uebersetzen. */
function scoreLabel(score) {
  if (score == null || Number.isNaN(score)) return { level: 'unknown', text: 'unbekannt' };
  if (score <= 4) return { level: 'good', text: 'unauffaellig' };
  if (score <= 6) return { level: 'warn', text: 'verdaechtig' };
  return { level: 'bad', text: 'wahrscheinlich Werbung/Spam' };
}

function looksLikeRealKey(t) {
  return t && t.partner && t.apikey && !(t.partner === 'test' && t.apikey === 'test123');
}

/** Offizielle JSON-API (nur mit gueltigem Partner-Account). */
async function lookupTellowsApi(number, { partner, apikey }) {
  const url =
    `https://www.tellows.de/basic/num/${encodeURIComponent(number)}` +
    `?json=1&partner=${encodeURIComponent(partner)}&apikey=${encodeURIComponent(apikey)}&country=de`;

  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  const body = await res.text();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json') || body.trimStart().startsWith('<')) {
    throw new Error('keine gueltige API-Antwort (Partner-Key noetig?)');
  }

  const data = JSON.parse(body);
  const t = data.tellows || data || {};
  const score = t.score != null && t.score !== '' ? parseInt(t.score, 10) : null;

  let types = [];
  const raw = t.callerTypes && t.callerTypes.caller;
  if (Array.isArray(raw)) types = raw.map((c) => ({ name: c.name, count: Number(c.count) || 0 }));
  else if (raw && raw.name) types = [{ name: raw.name, count: Number(raw.count) || 0 }];

  return {
    source: 'tellows-api',
    score,
    label: scoreLabel(score),
    comments: t.comments != null ? parseInt(t.comments, 10) || 0 : 0,
    location: t.location || null,
    callerName: t.callerName || null,
    types,
    webUrl: `https://www.tellows.de/num/${encodeURIComponent(number)}`,
  };
}

/** Scraping der oeffentlichen Nummern-Seite (kein Key noetig). */
async function lookupTellowsScrape(number) {
  const num = nationalDE(number);
  const url = `https://www.tellows.de/num/${encodeURIComponent(num)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`tellows HTTP ${res.status}`);
  const html = await res.text();

  // Score: bevorzugt aus dem Score-Bild (score/s5.jpg), sonst aus dem Titel.
  let score = null;
  const imgMatch = html.match(/score\/s(\d+)\.(?:jpg|png|svg)/i);
  const titleMatch = html.match(/Score Telefonnummer:\s*(\d+)/i);
  if (imgMatch) score = parseInt(imgMatch[1], 10);
  else if (titleMatch) score = parseInt(titleMatch[1], 10);

  // Ort: aus dem H1 ("030120903 aus Berlin") oder dem Titel ("... aus Berlin |").
  let location = null;
  const h1 = html.match(/<h1[^>]*>\s*[+\d\s]+aus\s+([^<]+?)\s*<\/h1>/i);
  const titleLoc = html.match(/aus\s+([^|<]+?)\s*\|/i);
  if (h1) location = h1[1].trim();
  else if (titleLoc) location = titleLoc[1].trim();

  return {
    source: 'tellows-scrape',
    score,
    label: scoreLabel(score),
    comments: 0,
    location,
    callerName: null,
    types: [],
    webUrl: url,
  };
}

async function llmVerdict(number, tellows, { apiKey, model }) {
  if (!apiKey) return null;

  const typeList = tellows && tellows.types && tellows.types.length
    ? tellows.types.map((x) => `${x.name} (${x.count})`).join(', ')
    : 'keine';

  const prompt =
    `Daten zu einer eingehenden Telefonnummer von der Spam-Meldeseite tellows.\n\n` +
    `Nummer: ${number}\n` +
    `tellows-Score (1-9, ab 5 zunehmend negativ): ${tellows && tellows.score != null ? tellows.score : 'unbekannt'}\n` +
    `Anzahl Bewertungen: ${tellows ? tellows.comments : 0}\n` +
    `Gemeldete Anrufer-Typen: ${typeList}\n` +
    `Ort/Info: ${(tellows && tellows.location) || 'unbekannt'}\n\n` +
    `Gib in EINEM kurzen deutschen Satz eine Einschaetzung, ob das vermutlich ` +
    `ein serioeser Anruf oder ein Werbe-/Spam-Anruf ist und worum es vermutlich geht. ` +
    `Keine Einleitung, kein Vorwort.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join(' ').trim();
  return text || null;
}

/** Vollstaendige Recherche fuer eine Nummer. */
async function lookupCaller(rawNumber, settings) {
  const number = normalize(rawNumber);
  const result = { number, rawNumber, ts: Date.now() };

  if (!number) {
    result.suppressed = true;
    return result;
  }

  // Eigene Markierung/Name zuerst – hat Vorrang in der Anzeige.
  result.contact = getContact(number);

  try {
    if (looksLikeRealKey(settings.tellows)) {
      try {
        result.tellows = await lookupTellowsApi(number, settings.tellows);
      } catch {
        result.tellows = await lookupTellowsScrape(number); // Fallback
      }
    } else {
      result.tellows = await lookupTellowsScrape(number);
    }
  } catch (e) {
    result.tellowsError = e.message;
  }

  if (settings.llm && settings.llm.apiKey) {
    try {
      result.verdict = await llmVerdict(number, result.tellows, settings.llm);
    } catch (e) {
      result.verdictError = e.message;
    }
  }

  return result;
}

module.exports = {
  lookupCaller,
  lookupTellowsApi,
  lookupTellowsScrape,
  normalize,
  scoreLabel,
};
