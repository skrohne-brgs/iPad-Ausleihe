'use strict';
const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const Handlebars = require('handlebars');
const dayjs = require('dayjs');
require('dayjs/locale/de');
dayjs.locale('de');

const TEMPLATES_DIR = path.join(__dirname, '../renderer/templates');

function documentsDir() {
  const dir = path.join(app.getPath('userData'), 'documents', dayjs().format('YYYY-MM'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.hbs`), 'utf8');
}

function logoBase64(logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  const ext = path.extname(logoPath).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`;
}

function fmtDate(d) { return d ? dayjs(d).format('D. MMMM YYYY') : '—'; }
function fmtCurrency(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function safeName(s) { return (s || '').replace(/[^a-zA-Z0-9._-]/g, '_'); }

async function renderToPdf(templateName, data) {
  const html = Handlebars.compile(readTemplate(templateName))(data);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      marginsType: 0,
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
    });
  } finally {
    win.destroy();
  }
}

async function generateMietvertrag(rental, settings) {
  const filename = `Mietvertrag_${safeName(rental.last_name)}_${safeName(rental.asset_tag)}_${rental.lent_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  const data = {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  rental,
    ipad:     rental,
    rental: {
      ...rental,
      lent_date_formatted: fmtDate(rental.lent_date),
      due_date_formatted: rental.due_date ? fmtDate(rental.due_date) : 'nach Vereinbarung',
      vertrag_nr: `${rental.id}/${dayjs().year()}`,
      condition_label: conditionLabel(rental.condition_at_lend),
    },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
  const buf = await renderToPdf('mietvertrag', data);
  fs.writeFileSync(out, buf);
  shell.openPath(out);
  return out;
}

async function generateRueckgabe(rec, settings) {
  const filename = `Rueckgabe_${safeName(rec.last_name)}_${safeName(rec.asset_tag)}_${rec.return_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  const data = {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  rec,
    ipad:     rec,
    ret: {
      ...rec,
      return_date_formatted: fmtDate(rec.return_date),
      condition_label: conditionLabel(rec.condition),
    },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
  const buf = await renderToPdf('rueckgabe', data);
  fs.writeFileSync(out, buf);
  shell.openPath(out);
  return out;
}

async function generateVerlustanzeige(report, settings) {
  const prefix = report.incident_type === 'verlust' ? 'Verlustanzeige' : 'Defektanzeige';
  const filename = `${prefix}_${safeName(report.last_name)}_${safeName(report.asset_tag)}_${report.report_date}.pdf`;
  const out = path.join(documentsDir(), filename);
  const data = {
    settings: { ...settings, logo: logoBase64(settings.school_logo_path) },
    student:  report,
    ipad:     report,
    report: {
      ...report,
      report_date_formatted: fmtDate(report.report_date),
      repair_cost_formatted: fmtCurrency(report.repair_cost),
      type_label:  report.incident_type === 'verlust' ? 'Verlustanzeige' : 'Defektanzeige',
      is_verlust:  report.incident_type === 'verlust',
      is_defekt:   report.incident_type === 'defekt',
    },
    created_date: fmtDate(dayjs().format('YYYY-MM-DD')),
  };
  const buf = await renderToPdf('verlustanzeige', data);
  fs.writeFileSync(out, buf);
  shell.openPath(out);
  return out;
}

function conditionLabel(c) {
  return { gut: 'Gut', leichte_maengel: 'Leichte Maengel', stark_beschaedigt: 'Stark beschaedigt',
           defekt: 'Defekt', verloren: 'Verloren' }[c] || c || '—';
}

module.exports = { generateMietvertrag, generateRueckgabe, generateVerlustanzeige };
