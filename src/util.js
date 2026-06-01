'use strict';

/** Nummer grob normalisieren (00xx -> +xx, Sonderzeichen weg). */
function normalize(number) {
  let n = (number || '').replace(/[^\d+]/g, '');
  if (n.startsWith('00')) n = '+' + n.slice(2);
  return n;
}

/** Deutsche Inlandsform (+49... -> 0...). */
function nationalDE(number) {
  if (number.startsWith('+49')) return '0' + number.slice(3);
  return number;
}

module.exports = { normalize, nationalDE };
