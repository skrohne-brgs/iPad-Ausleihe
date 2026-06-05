'use strict';
const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const Handlebars = require('handlebars');
const dayjs = require('dayjs');
require('dayjs/locale/de');
dayjs.locale('de');

const TEMPLATES_DIR = path.join(__dirname, '../renderer/templates');

const DAMAGE_TYPE_LABELS = {
  fluessigkeit: 'Flüssigkeitsschaden',
  display:      'Displayschaden',
  gehaeuse:     'Gehäuseschaden',
  akku:         'Akkuschaden',
  ladebuchse:   'Schaden Ladebuchse',
  smart_pen:    'Schaden an der Spitze des Smart-Pens',
  sonstiger:    'Sonstiger Schaden',
};

function documentsDir() {
  const dir = path.join(app.getPath('userData'), 'documents', dayjs().format('YYYY-MM'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readTemplate(name) { return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.hbs`), 'utf8'); }
function logoBase64(logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  const ext = path.extname(logoPath).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`;
}
function fmtDate(d) { return d ? dayjs(d).format('D. MMMM YYYY') : '—'; }
function fmtCurrency(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' }).format(n);
}
function safeName(s) { return (s||'').replace(/[^a-zA-Z0-9._-]/g,'_'); }
function conditionLabel(c) {
  return { gut:'Gut',leichte_maengel:'Leichte Mängel',stark_beschaedigt:'Stark beschädigt',
    defekt:'Defekt',verloren:'Verloren' }[c] || c || '—';
}
function parseDamageTypes(dtJson) {
  try {
    const selected = JSON.parse(dtJson || '[]');
    return Object.keys(DAMAGE_TYPE_LABELS).map(k => ({
      key: k, label: DAMAGE_TYPE_LABELS[k], checked: selected.includes(k), is_other: k === 'sonstiger',
    }));
  } catch {
    return Object.keys(DAMAGE_TYPE_LABELS).map(k => ({ key: k, label: DAMAGE_TYPE_LABELS[k], checked: false, is_other: k === 'sonstiger' }));
  }
}
function calcSchuljahr(lentDate) {
  const d = dayjs(lentDate);
  const m = d.month() + 1;
  const y = d.year();
  return m >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

async function renderToPdf(templateName, data) {
  const html = Handlebars.compile(readTemplate(templateName))(data);
  const win = new BrowserWindow({ show:false, webPreferences:{ javascript:false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await win.webContents.printToPDF({ pageSize:'A4', printBackground:true, marginsType:0 });
  } finally { win.destroy(); }
}

function borrowerData(rec) {
  const is_teacher = rec.borrower_type === 'lehrer';
  return {
    ...rec,
    is_teacher,
    is_student: !is_teacher,
    borrower_section_label: is_teacher ? 'Daten der Lehrkraft' : 'Daten der Schülerin / des Schülers',
    class_label: is_teacher ? 'Fach / Funktion' : 'Klasse',
  };
}

// --- Daten-Builder (geteilt zwischen Einzel- und Serienausleihe) ---
function mietvertragData(rental, settings) {
  const ry = Number(rental.rental_age_years) || 0;
  return {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  borrowerData(rental),
    ipad: {
      ...rental,
      rental_age_0: ry === 0,
      rental_age_1: ry === 1,
      rental_age_2: ry === 2,
      rental_age_3: ry >= 3,
    },
    rental: {
      ...rental,
      schuljahr: calcSchuljahr(rental.lent_date),
      lent_date_formatted: fmtDate(rental.lent_date),
      due_date_formatted: rental.due_date ? fmtDate(rental.due_date) : 'nach Vereinbarung',
      vertrag_nr: `${rental.id}/${dayjs().year()}`,
      condition_label: conditionLabel(rental.condition_at_lend),
    },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
}
function empfangData(rental, settings) {
  const ry = Number(rental.rental_age_years) || 0;
  return {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student: borrowerData(rental),
    ipad: { ...rental, rental_age_0: ry===0, rental_age_1: ry===1, rental_age_2: ry===2, rental_age_3: ry>=3 },
    rental: { ...rental, lent_date_formatted: fmtDate(rental.lent_date) },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
}

// --- Buffer-Renderer (kein Schreiben/Oeffnen, fuer Serien-Flows) ---
async function renderMietvertragBuffer(rental, settings) { return renderToPdf('mietvertrag', mietvertragData(rental, settings)); }
async function renderEmpfangBuffer(rental, settings)     { return renderToPdf('empfangsbestaetigung', empfangData(rental, settings)); }
function rueckgabeData(rec, settings) {
  return {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  borrowerData(rec),
    ipad:     rec,
    ret: { ...rec, return_date_formatted: fmtDate(rec.return_date), condition_label: conditionLabel(rec.condition) },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
}
async function renderRueckgabeBuffer(rec, settings) { return renderToPdf('rueckgabe', rueckgabeData(rec, settings)); }

async function generateMietvertrag(rental, settings) {
  const filename = `Mietvertrag_${safeName(rental.last_name)}_${safeName(rental.asset_tag)}_${rental.lent_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  fs.writeFileSync(out, await renderMietvertragBuffer(rental, settings));
  shell.openPath(out);
  return out;
}

async function generateEmpfangsbestaetigung(rental, settings) {
  const filename = `Empfangsbestaetigung_${safeName(rental.last_name)}_${safeName(rental.asset_tag)}_${rental.lent_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  fs.writeFileSync(out, await renderEmpfangBuffer(rental, settings));
  shell.openPath(out);
  return out;
}

// PDF-Buffer zu einer Datei zusammenfuehren (fuer die Sammel-PDFs der Serienausleihe).
async function mergePdfBuffers(buffers) {
  const { PDFDocument } = require('pdf-lib');
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src   = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

async function generateRueckgabe(rec, settings) {
  const filename = `Rueckgabe_${safeName(rec.last_name)}_${safeName(rec.asset_tag)}_${rec.return_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  fs.writeFileSync(out, await renderRueckgabeBuffer(rec, settings));
  shell.openPath(out);
  return out;
}

async function generateVerlustanzeige(report, settings) {
  const prefix = report.incident_type === 'verlust' ? 'Verlustanzeige' : 'Defektanzeige';
  const filename = `${prefix}_${safeName(report.last_name)}_${safeName(report.asset_tag)}_${report.report_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  const damageTypes = parseDamageTypes(report.damage_types);
  const data = {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  borrowerData(report),
    ipad:     report,
    report: {
      ...report,
      report_date_formatted: fmtDate(report.report_date),
      repair_cost_formatted: fmtCurrency(report.repair_cost),
      type_label: report.incident_type === 'verlust' ? 'Verlustanzeige' : 'Defektanzeige',
      is_verlust: report.incident_type === 'verlust',
      is_defekt:  report.incident_type === 'defekt',
      damage_types: damageTypes,
      has_damage_types: damageTypes.some(dt => dt.checked),
    },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
  fs.writeFileSync(out, await renderToPdf('verlustanzeige', data));
  shell.openPath(out);
  return out;
}

module.exports = {
  generateMietvertrag, generateEmpfangsbestaetigung, generateRueckgabe, generateVerlustanzeige,
  renderMietvertragBuffer, renderEmpfangBuffer, renderRueckgabeBuffer, mergePdfBuffers, safeName,
};
