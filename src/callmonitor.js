'use strict';

const net = require('net');
const { EventEmitter } = require('events');

/**
 * Verbindet sich mit dem FRITZ!Box Call Monitor (TCP, Standard-Port 1012)
 * und emittiert pro Ereignis ein 'call'-Event sowie Verbindungs-Status.
 *
 * Aktivierung an der Fritz!Box (einmalig): an einem angeschlossenen
 * Telefon `#96*5*` waehlen. Deaktivieren mit `#96*4*`.
 *
 * Zeilenformat (durch ';' getrennt):
 *   datum;RING;ConnID;AnruferNr;AngerufeneNr;SIP;
 *   datum;CALL;ConnID;Nebenstelle;EigeneNr;ZielNr;SIP;
 *   datum;CONNECT;ConnID;Nebenstelle;Nummer;
 *   datum;DISCONNECT;ConnID;DauerSekunden;
 */
class CallMonitor extends EventEmitter {
  constructor({ host, port = 1012, reconnectDelay = 5000 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.reconnectDelay = reconnectDelay;
    this.socket = null;
    this.shouldRun = false;
    this.buffer = '';
  }

  start() {
    this.shouldRun = true;
    this._connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  _connect() {
    this.emit('status', { connected: false, connecting: true, host: this.host, port: this.port });
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.emit('status', { connected: true, connecting: false, host: this.host, port: this.port });
    });

    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this._parseLine(line);
      }
    });

    socket.on('error', (err) => {
      this.emit('status', { connected: false, connecting: false, error: err.message, host: this.host, port: this.port });
    });

    socket.on('close', () => {
      this.socket = null;
      this.emit('status', { connected: false, connecting: false, host: this.host, port: this.port });
      if (this.shouldRun) {
        setTimeout(() => {
          if (this.shouldRun) this._connect();
        }, this.reconnectDelay);
      }
    });
  }

  _parseLine(line) {
    const parts = line.split(';');
    const datetime = parts[0];
    const type = parts[1];
    const event = { raw: line, datetime, type };

    switch (type) {
      case 'RING': // eingehend
        event.connectionId = parts[2];
        event.caller = (parts[3] || '').trim();
        event.called = (parts[4] || '').trim();
        break;
      case 'CALL': // ausgehend
        event.connectionId = parts[2];
        event.extension = parts[3];
        event.caller = (parts[4] || '').trim();
        event.called = (parts[5] || '').trim();
        break;
      case 'CONNECT':
        event.connectionId = parts[2];
        event.extension = parts[3];
        event.number = (parts[4] || '').trim();
        break;
      case 'DISCONNECT':
        event.connectionId = parts[2];
        event.duration = parts[3];
        break;
      default:
        break;
    }

    this.emit('call', event);
  }
}

module.exports = { CallMonitor };
