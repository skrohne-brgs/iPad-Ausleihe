'use strict';
const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings, iPads, Students, Rentals, Returns, IncidentReports, AuditLog, Dashboard } = require('./database');
const { generateMietvertrag, generateRueckgabe, generateVerlustanzeige } = require('./pdf-generator');

function registerIpcHandlers() {
  // Settings
  ipcMain.handle('settings:get', () => Settings.getAll());
  ipcMain.handle('settings:set', (_, key, value) => { Settings.set(key, value); });
  ipcMain.handle('settings:selectLogo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Schullogo auswaehlen',
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'svg'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    const src = result.filePaths[0];
    const ext = path.extname(src);
    const dest = path.join(app.getPath('userData'), `school-logo${ext}`);
    fs.copyFileSync(src, dest);
    Settings.set('school_logo_path', dest);
    return dest;
  });

  // iPads
  ipcMain.handle('ipads:getAll', (_, filter) => iPads.getAll(filter));
  ipcMain.handle('ipads:getById', (_, id) => iPads.getById(id));
  ipcMain.handle('ipads:create', (_, data) => iPads.create(data));
  ipcMain.handle('ipads:update', (_, id, data) => { iPads.update(id, data); });
  ipcMain.handle('ipads:delete', (_, id) => {
    try { iPads.delete(id); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Students
  ipcMain.handle('students:getAll', (_, filter) => Students.getAll(filter));
  ipcMain.handle('students:getById', (_, id) => Students.getById(id));
  ipcMain.handle('students:create', (_, data) => Students.create(data));
  ipcMain.handle('students:update', (_, id, data) => { Students.update(id, data); });
  ipcMain.handle('students:delete', (_, id) => {
    try { Students.delete(id); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('students:search', (_, query) => Students.search(query));

  // Rentals
  ipcMain.handle('rentals:getAll', (_, filter) => Rentals.getAll(filter));
  ipcMain.handle('rentals:getById', (_, id) => Rentals.getById(id));
  ipcMain.handle('rentals:create', (_, data) => Rentals.create(data));
  ipcMain.handle('rentals:return', (_, id, data) => Rentals.return(id, data));

  // Incident Reports
  ipcMain.handle('incidents:create', (_, data) => IncidentReports.create(data));

  // PDF: Mietvertrag
  ipcMain.handle('pdf:mietvertrag', async (_, rentalId) => {
    try {
      const rental = Rentals.getById(rentalId);
      const settings = Settings.getAll();
      const pdfPath = await generateMietvertrag(rental, settings);
      Rentals.updatePdf(rentalId, path.relative(app.getPath('userData'), pdfPath));
      return { success: true, path: pdfPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // PDF: Rueckgabe
  ipcMain.handle('pdf:rueckgabe', async (_, returnId) => {
    try {
      const rec = Returns.getById(returnId);
      const settings = Settings.getAll();
      const pdfPath = await generateRueckgabe(rec, settings);
      Returns.updatePdf(returnId, path.relative(app.getPath('userData'), pdfPath));
      return { success: true, path: pdfPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // PDF: Verlust-/Defektanzeige
  ipcMain.handle('pdf:verlustanzeige', async (_, incidentId) => {
    try {
      const report = IncidentReports.getById(incidentId);
      const settings = Settings.getAll();
      const pdfPath = await generateVerlustanzeige(report, settings);
      IncidentReports.updatePdf(incidentId, path.relative(app.getPath('userData'), pdfPath));
      return { success: true, path: pdfPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // Audit Log & Dashboard
  ipcMain.handle('audit:getLog', (_, filter) => AuditLog.getAll(filter));
  ipcMain.handle('dashboard:stats', () => Dashboard.getStats());

  // Backup: Export
  ipcMain.handle('backup:export', async () => {
    const backupDir = Settings.get('backup_dir');
    const result = await dialog.showSaveDialog({
      title: 'Datenbank exportieren',
      defaultPath: path.join(
        backupDir || app.getPath('documents'),
        `ipad-ausleihe-backup-${new Date().toISOString().slice(0, 10)}.db`
      ),
      filters: [{ name: 'Datenbank', extensions: ['db'] }],
    });
    if (result.canceled) return { success: false };
    fs.copyFileSync(path.join(app.getPath('userData'), 'ipad-ausleihe.db'), result.filePath);
    return { success: true, path: result.filePath };
  });

  // Backup: Import
  ipcMain.handle('backup:import', async (event) => {
    const result = await dialog.showOpenDialog({
      title: 'Backup importieren',
      filters: [{ name: 'Datenbank', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return { success: false };
    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Importieren', 'Abbrechen'],
      defaultId: 1,
      title: 'Daten importieren',
      message: 'Alle aktuellen Daten werden ueberschrieben!',
      detail: 'Die aktuelle Datenbank wird durch die ausgewaehlte Backup-Datei ersetzt. Diese Aktion kann nicht rueckgaengig gemacht werden.',
    });
    if (confirm.response !== 0) return { success: false };
    fs.copyFileSync(result.filePaths[0], path.join(app.getPath('userData'), 'ipad-ausleihe.db'));
    await dialog.showMessageBox({
      type: 'info',
      title: 'Import erfolgreich',
      message: 'Die App wird jetzt neu gestartet.',
    });
    app.relaunch();
    app.exit(0);
    return { success: true };
  });
}

module.exports = { registerIpcHandlers };
