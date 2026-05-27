'use strict';

// UTF-8 BOM fuer Excel-Kompatibilitaet
const BOM = '﻿';
const SEP = ';';

function escapeField(v) {
  const s = String(v ?? '');
  // Quote if contains separator, quote, newline
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(escapeField).join(SEP)];
  for (const row of rows) {
    lines.push(headers.map(h => escapeField(row[h] ?? '')).join(SEP));
  }
  return BOM + lines.join('\r\n');
}

function parseCsv(text) {
  // Strip BOM
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = src.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  // Auto-detect delimiter: prefer ; over ,
  const header = lines[0];
  const sep = header.includes(';') ? ';' : ',';

  const keys = parseLine(header, sep).map(k => k.trim());
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i], sep);
    const obj = {};
    keys.forEach((k, idx) => { obj[k] = (vals[idx] ?? '').trim(); });
    records.push(obj);
  }
  return records;
}

function parseLine(line, sep) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === sep) { fields.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

module.exports = { buildCsv, parseCsv };
