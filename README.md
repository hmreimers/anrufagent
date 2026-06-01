# K!Anrufagent

Kleines Electron-Tool für die AVM FRITZ!Box, das eingehende Anrufe live anzeigt und
den Anrufer automatisch gegen die Werbeanruf-Meldeseite **tellows** prueft –
optional mit kurzer **LLM-Einschaetzung**. Alles laeuft lokal auf dem Rechner.

## Funktionsweise

Die Fritz!Box hat einen **Call Monitor**: einen TCP-Stream auf Port `1012`,
der bei jedem Klingeln eine Textzeile mit der Anrufernummer pusht. Das Tool
liest diesen Stream, parst die `RING`-Ereignisse und recherchiert die Nummer.

## Einrichtung

1. **Call Monitor an der Fritz!Box aktivieren** (einmalig):
   An einem angeschlossenen Telefon **`#96*5*`** waehlen.
   (Deaktivieren mit `#96*4*`.)

2. Abhaengigkeiten installieren und starten:
   ```powershell
   npm install
   npm start
   ```

3. In den **Einstellungen** (Zahnrad) eintragen:
   - **Fritz!Box Host**: meist `fritz.box` oder `192.168.178.1`
   - **tellows Partner / API-Key**: eigenen Partner-Account auf
     <https://www.tellows.de/c/partner/> anlegen. Die voreingestellten
     Test-Credentials (`test` / `test123`) sind oft stark limitiert.
   - **Anthropic API-Key** (optional): aktiviert die LLM-Einschaetzung.
     Leer lassen = aus.

## Hinweise

- Ohne aktiven Call Monitor (`#96*5*`) bekommt das Tool keine Anruf-Events.
- Die manuelle Pruefung (Eingabefeld oben) funktioniert auch ohne Fritz!Box.
- Echte Anruferdaten haengen von tellows ab; unbekannte Nummern liefern wenig.
- Die Direktlinks (tellows / Google / Das Oertliche) oeffnen die Nummer im
  Browser fuer eine schnelle manuelle Websuche.

## Dateien

| Datei | Zweck |
|-------|-------|
| `main.js` | Electron-Hauptprozess, verdrahtet Monitor + Recherche + IPC |
| `src/callmonitor.js` | TCP-Client + Parser fuer den Call Monitor |
| `src/lookup.js` | tellows-Abfrage + optionale LLM-Einschaetzung |
| `src/settings.js` | Einstellungen laden/speichern (userData) |
| `renderer/` | UI (HTML/CSS/JS) |
