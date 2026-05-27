'use strict';
const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings, iPads, Students, Rentals, Returns, IncidentReports, AuditLog, Dashboard, backupToPath } = require('./database');
const { generateMietvertrag, generateEmpfangsbestaetigung, generateRueckgabe, generateVerlustanzeige } = require('./pdf-generator');
const { buildCsv, parseCsv } = require('./csv');
const { testConnection, uploadDb, scheduleUpload } = require('./webdav-sync');
const { generateDataUrl, openStickerSheet } = require('./qrcode-gen');

function triggerSync() {
  const s = Settings.getAll();
  if (s.webdav_enabled !== '1') return;
  scheduleUpload(s, backupToPath, err => {
    if (err) console.error('WebDAV sync error:', err.message);
    else Settings.set('webdav_last_sync', new Date().toLocaleString('de-DE'));
  });
}

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => Settings.getAll());
  ipcMain.handle('settings:set', (_, k, v) => { Settings.set(k, v); triggerSync(); });
  ipcMain.handle('settings:selectLogo', async () => {
    const r = await dialog.showOpenDialog({ title:'Schullogo', filters:[{name:'Bilder',extensions:['png','jpg','jpeg','svg']}], properties:['openFile'] });
    if (r.canceled) return null;
    const ext = path.extname(r.filePaths[0]);
    const dest = path.join(app.getPath('userData'), `school-logo${ext}`);
    fs.copyFileSync(r.filePaths[0], dest);
    Settings.set('school_logo_path', dest);
    return dest;
  });

  ipcMain.handle('ipads:getAll',  (_, f)    => iPads.getAll(f));
  ipcMain.handle('ipads:getById', (_, id)   => iPads.getById(id));
  ipcMain.handle('ipads:create',  (_, d)    => { const id = iPads.create(d); triggerSync(); return id; });
  ipcMain.handle('ipads:update',  (_, id,d) => { iPads.update(id,d); triggerSync(); });
  ipcMain.handle('ipads:delete',  (_, id)   => { try { iPads.delete(id); triggerSync(); return {success:true}; } catch(e){return{success:false,error:e.message};} });

  ipcMain.handle('students:getAll',  (_, f)    => Students.getAll(f));
  ipcMain.handle('students:getById', (_, id)   => Students.getById(id));
  ipcMain.handle('students:create',  (_, d)    => { const id = Students.create(d); triggerSync(); return id; });
  ipcMain.handle('students:update',  (_, id,d) => { Students.update(id,d); triggerSync(); });
  ipcMain.handle('students:delete',  (_, id)   => { try { Students.delete(id); triggerSync(); return {success:true}; } catch(e){return{success:false,error:e.message};} });
  ipcMain.handle('students:search',  (_, q)    => Students.search(q));

  ipcMain.handle('rentals:getAll',  (_, f)    => Rentals.getAll(f));
  ipcMain.handle('rentals:getById', (_, id)   => Rentals.getById(id));
  ipcMain.handle('rentals:create',  (_, d)    => { const id = Rentals.create(d); triggerSync(); return id; });
  ipcMain.handle('rentals:return',  (_, id,d) => { const r = Rentals.return(id,d); triggerSync(); return r; });

  ipcMain.handle('incidents:create', (_, d) => { const id = IncidentReports.create(d); triggerSync(); return id; });

  ipcMain.handle('pdf:mietvertrag', async (_, rentalId) => {
    try { const rental=Rentals.getById(rentalId),settings=Settings.getAll(),p=await generateMietvertrag(rental,settings); Rentals.updatePdf(rentalId,path.relative(app.getPath('userData'),p)); return{success:true,path:p}; } catch(e){return{success:false,error:e.message};}
  });
  ipcMain.handle('pdf:empfangsbestaetigung', async (_, rentalId) => {
    try { const rental=Rentals.getById(rentalId),settings=Settings.getAll(),p=await generateEmpfangsbestaetigung(rental,settings); return{success:true,path:p}; } catch(e){return{success:false,error:e.message};}
  });
  ipcMain.handle('pdf:rueckgabe', async (_, returnId) => {
    try { const rec=Returns.getById(returnId),settings=Settings.getAll(),p=await generateRueckgabe(rec,settings); Returns.updatePdf(returnId,path.relative(app.getPath('userData'),p)); return{success:true,path:p}; } catch(e){return{success:false,error:e.message};}
  });
  ipcMain.handle('pdf:verlustanzeige', async (_, incidentId) => {
    try { const rep=IncidentReports.getById(incidentId),settings=Settings.getAll(),p=await generateVerlustanzeige(rep,settings); IncidentReports.updatePdf(incidentId,path.relative(app.getPath('userData'),p)); return{success:true,path:p}; } catch(e){return{success:false,error:e.message};}
  });

  ipcMain.handle('audit:getLog',     (_, f) => AuditLog.getAll(f));
  ipcMain.handle('dashboard:stats',  ()     => Dashboard.getStats());

  ipcMain.handle('backup:export', async () => {
    const r = await dialog.showSaveDialog({ title:'Datenbank exportieren', defaultPath:path.join(Settings.get('backup_dir')||app.getPath('documents'),`ipad-ausleihe-backup-${new Date().toISOString().slice(0,10)}.db`), filters:[{name:'Datenbank',extensions:['db']}] });
    if (r.canceled) return {success:false};
    fs.copyFileSync(path.join(app.getPath('userData'),'ipad-ausleihe.db'),r.filePath);
    return {success:true,path:r.filePath};
  });
  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog({ title:'Backup importieren', filters:[{name:'Datenbank',extensions:['db']}], properties:['openFile'] });
    if (r.canceled) return {success:false};
    const c = await dialog.showMessageBox({ type:'warning',buttons:['Importieren','Abbrechen'],defaultId:1,title:'Daten importieren',message:'Alle aktuellen Daten werden ueberschrieben!' });
    if (c.response!==0) return {success:false};
    fs.copyFileSync(r.filePaths[0],path.join(app.getPath('userData'),'ipad-ausleihe.db'));
    await dialog.showMessageBox({type:'info',title:'Import erfolgreich',message:'Die App wird neu gestartet.'});
    app.relaunch(); app.exit(0);
  });

  // CSV
  ipcMain.handle('csv:students:export', async () => {
    const r = await dialog.showSaveDialog({ title:'Schuelerliste exportieren', defaultPath:path.join(app.getPath('documents'),`schueler-${new Date().toISOString().slice(0,10)}.csv`), filters:[{name:'CSV',extensions:['csv']}] });
    if (r.canceled) return {success:false};
    const rows = Students.getAll();
    fs.writeFileSync(r.filePath, buildCsv(['Nachname','Vorname','Klasse','Typ','Moin-Benutzername','Eltern-Email','Eltern-Telefon','Notizen'],
      rows.map(s=>({'Nachname':s.last_name,'Vorname':s.first_name,'Klasse':s.class,'Typ':s.borrower_type==='lehrer'?'Lehrer':'Schueler','Moin-Benutzername':s.moin_username,'Eltern-Email':s.guardian_email,'Eltern-Telefon':s.guardian_phone,'Notizen':s.notes}))), 'utf8');
    return {success:true,path:r.filePath,count:rows.length};
  });
  ipcMain.handle('csv:students:import', async () => {
    const r = await dialog.showOpenDialog({ title:'Schuelerliste importieren', filters:[{name:'CSV',extensions:['csv','txt']}], properties:['openFile'] });
    if (r.canceled) return {success:false};
    const records = parseCsv(fs.readFileSync(r.filePaths[0],'utf8'));
    let imported=0,skipped=0;
    for (const rec of records) {
      const last=rec['Nachname']||rec['last_name']||'', first=rec['Vorname']||rec['first_name']||'', cls=rec['Klasse']||rec['class']||'';
      if (!last||!first||!cls){skipped++;continue;}
      const typ = (rec['Typ']||'').toLowerCase()==='lehrer'?'lehrer':'schueler';
      try { Students.create({last_name:last,first_name:first,class:cls,borrower_type:typ,moin_username:rec['Moin-Benutzername']||'',guardian_email:rec['Eltern-Email']||'',guardian_phone:rec['Eltern-Telefon']||'',notes:rec['Notizen']||''}); imported++; }
      catch { skipped++; }
    }
    if (imported>0) triggerSync();
    return {success:true,imported,skipped};
  });
  ipcMain.handle('csv:ipads:export', async () => {
    const r = await dialog.showSaveDialog({ title:'iPad-Liste exportieren', defaultPath:path.join(app.getPath('documents'),`ipads-${new Date().toISOString().slice(0,10)}.csv`), filters:[{name:'CSV',extensions:['csv']}] });
    if (r.canceled) return {success:false};
    const rows = iPads.getAll();
    fs.writeFileSync(r.filePath, buildCsv(['Nummer','Modell','Seriennummer','Status','Notizen'],
      rows.map(ip=>({'Nummer':ip.asset_tag,'Modell':ip.model,'Seriennummer':ip.serial,'Status':ip.status,'Notizen':ip.notes}))), 'utf8');
    return {success:true,path:r.filePath,count:rows.length};
  });
  ipcMain.handle('csv:ipads:import', async () => {
    const r = await dialog.showOpenDialog({ title:'iPad-Liste importieren', filters:[{name:'CSV',extensions:['csv','txt']}], properties:['openFile'] });
    if (r.canceled) return {success:false};
    const records = parseCsv(fs.readFileSync(r.filePaths[0],'utf8'));
    let imported=0,skipped=0;
    for (const rec of records) {
      const tag=rec['Nummer']||'',model=rec['Modell']||'',serial=rec['Seriennummer']||'';
      if (!tag||!model||!serial){skipped++;continue;}
      try { iPads.create({asset_tag:tag,model,serial,notes:rec['Notizen']||''}); imported++; } catch {skipped++;}
    }
    if (imported>0) triggerSync();
    return {success:true,imported,skipped};
  });
  ipcMain.handle('csv:template:students', async () => {
    const r = await dialog.showSaveDialog({ title:'Vorlage speichern', defaultPath:path.join(app.getPath('documents'),'schueler-vorlage.csv'), filters:[{name:'CSV',extensions:['csv']}] });
    if (r.canceled) return {success:false};
    fs.writeFileSync(r.filePath, buildCsv(['Nachname','Vorname','Klasse','Typ','Moin-Benutzername','Eltern-Email','Eltern-Telefon','Notizen'],[{Nachname:'Mustermann',Vorname:'Max',Klasse:'9b',Typ:'Schueler','Moin-Benutzername':'max.mustermann','Eltern-Email':'eltern@schule.de','Eltern-Telefon':'04762 12345',Notizen:''}]), 'utf8');
    return {success:true};
  });
  ipcMain.handle('csv:template:ipads', async () => {
    const r = await dialog.showSaveDialog({ title:'Vorlage speichern', defaultPath:path.join(app.getPath('documents'),'ipads-vorlage.csv'), filters:[{name:'CSV',extensions:['csv']}] });
    if (r.canceled) return {success:false};
    fs.writeFileSync(r.filePath, buildCsv(['Nummer','Modell','Seriennummer','Notizen'],[{Nummer:'iPad-001',Modell:'iPad 10. Generation (64 GB, Wi-Fi)',Seriennummer:'FXXXXXXXXXXX',Notizen:''}]), 'utf8');
    return {success:true};
  });

  // WebDAV
  ipcMain.handle('webdav:test', async () => {
    try { await testConnection(Settings.getAll()); return {success:true}; }
    catch(e) { return {success:false,error:e.message}; }
  });
  ipcMain.handle('webdav:sync', async () => {
    try { await uploadDb(Settings.getAll(), backupToPath); Settings.set('webdav_last_sync',new Date().toLocaleString('de-DE')); return {success:true}; }
    catch(e) { return {success:false,error:e.message}; }
  });
  ipcMain.handle('webdav:download', async () => {
    const { downloadDb } = require('./webdav-sync');
    try {
      const buf = await downloadDb(Settings.getAll());
      if (!buf) return {success:false,error:'Keine Datei auf dem Server gefunden.'};
      const c = await dialog.showMessageBox({type:'warning',buttons:['Herunterladen','Abbrechen'],defaultId:1,title:'Von WebDAV laden',message:'Aktuelle Daten werden ueberschrieben!'});
      if (c.response!==0) return {success:false};
      fs.writeFileSync(path.join(app.getPath('userData'),'ipad-ausleihe.db'),buf);
      await dialog.showMessageBox({type:'info',title:'Fertig',message:'Die App wird neu gestartet.'});
      app.relaunch(); app.exit(0);
    } catch(e) { return {success:false,error:e.message}; }
  });

  // QR
  ipcMain.handle('qr:stickerSheet', async (_, ids) => {
    const all = ids && ids.length ? ids.map(id => iPads.getById(id)).filter(Boolean) : iPads.getAll();
    await openStickerSheet(all);
    return {success:true};
  });
  ipcMain.handle('qr:generate', async (_, tag) => {
    return generateDataUrl(tag);
  });
}

module.exports = { registerIpcHandlers };
