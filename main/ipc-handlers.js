'use strict';
const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings, iPads, Students, Rentals, Returns, IncidentReports, AuditLog, Dashboard, backupToPath } = require('./database');
const { generateMietvertrag, generateEmpfangsbestaetigung, generateRueckgabe, generateVerlustanzeige,
        renderMietvertragBuffer, renderEmpfangBuffer, renderRueckgabeBuffer, mergePdfBuffers, safeName } = require('./pdf-generator');
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
  ipcMain.handle('ipads:delete',      (_, id)   => { try { iPads.delete(id);           triggerSync(); return {success:true}; } catch(e){return{success:false,error:e.message};} });
  ipcMain.handle('ipads:deleteMany',  (_, ids)  => { try { const n=iPads.deleteMany(ids); triggerSync(); return {success:true,deleted:n}; } catch(e){return{success:false,error:e.message};} });

  ipcMain.handle('students:getAll',  (_, f)    => Students.getAll(f));
  ipcMain.handle('students:getById', (_, id)   => Students.getById(id));
  ipcMain.handle('students:create',  (_, d)    => { const id = Students.create(d); triggerSync(); return id; });
  ipcMain.handle('students:update',  (_, id,d) => { Students.update(id,d); triggerSync(); });
  ipcMain.handle('students:delete',  (_, id)   => { try { Students.delete(id); triggerSync(); return {success:true}; } catch(e){return{success:false,error:e.message};} });
  ipcMain.handle('students:search',  (_, q)    => Students.search(q));
  ipcMain.handle('students:getClasses', ()     => Students.getClasses());

  ipcMain.handle('rentals:getAll',  (_, f)    => Rentals.getAll(f));
  ipcMain.handle('rentals:getById', (_, id)   => Rentals.getById(id));
  ipcMain.handle('rentals:create',  (_, d)    => { const id = Rentals.create(d); triggerSync(); return id; });
  ipcMain.handle('rentals:return',  (_, id,d) => { const r = Rentals.return(id,d); triggerSync(); return r; });

  ipcMain.handle('incidents:create', (_, d) => { const id = IncidentReports.create(d); triggerSync(); return id; });

  // --- Serienausleihe ---
  // Ordnet Personen ausgewaehlter Klassen (alphabetisch) den verfuegbaren iPads
  // (fabrikneue zuerst) der Reihe nach zu und liefert eine Vorschau zurueck.
  ipcMain.handle('batch:plan', (_, classes) => {
    const persons = Students.getByClassesAvailable(classes || []);
    const ipads   = iPads.getAvailableSorted();
    const n = Math.min(persons.length, ipads.length);
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const s = persons[i], ip = ipads[i];
      pairs.push({
        student_id: s.id, last_name: s.last_name, first_name: s.first_name,
        class: s.class, borrower_type: s.borrower_type,
        ipad_id: ip.id, asset_tag: ip.asset_tag, model: ip.model,
        rental_age_years: ip.rental_age_years,
      });
    }
    return {
      pairs,
      personCount: persons.length,
      ipadCount: ipads.length,
      unassignedPersons: Math.max(0, persons.length - ipads.length),
      unusedIpads: Math.max(0, ipads.length - persons.length),
    };
  });

  // Fuehrt die geplanten Ausleihen aus: legt Mietvertraege an, erzeugt fuer jede
  // Person Leihvertrag + Empfangsbestaetigung als Einzeldatei und zusaetzlich zwei
  // Sammel-PDFs, alles im gewaehlten Zielordner.
  ipcMain.handle('batch:execute', async (event, payload) => {
    const { pairs, lent_date, due_date } = payload || {};
    if (!pairs || !pairs.length) return { success:false, error:'Keine Zuordnungen vorhanden.' };

    const dlg = await dialog.showOpenDialog({
      title: 'Zielordner fuer die Dokumente waehlen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (dlg.canceled || !dlg.filePaths.length) return { success:false, canceled:true };
    const targetDir = dlg.filePaths[0];

    const settings = Settings.getAll();
    const total = pairs.length;
    const mietBuffers = [], empfangBuffers = [];
    const errors = [];
    let done = 0;

    for (const p of pairs) {
      try {
        const rentalId = Rentals.create({
          ipad_id: p.ipad_id, student_id: p.student_id,
          lent_date, due_date: due_date || null,
          condition_at_lend: 'gut', accessories: '', notes: 'Serienausleihe',
        });
        const rental = Rentals.getById(rentalId);
        const mietBuf    = await renderMietvertragBuffer(rental, settings);
        const empfangBuf = await renderEmpfangBuffer(rental, settings);

        const base = `${safeName(rental.last_name)}_${safeName(rental.first_name)}_${safeName(rental.asset_tag)}`;
        fs.writeFileSync(path.join(targetDir, `Leihvertrag_${base}.pdf`), mietBuf);
        fs.writeFileSync(path.join(targetDir, `Empfangsbestaetigung_${base}.pdf`), empfangBuf);
        Rentals.updatePdf(rentalId, path.join(targetDir, `Leihvertrag_${base}.pdf`));

        mietBuffers.push(mietBuf);
        empfangBuffers.push(empfangBuf);
      } catch (e) {
        errors.push(`${p.last_name}, ${p.first_name}: ${e.message}`);
      }
      done++;
      event.sender.send('batch:progress', { done, total });
    }

    // Sammel-PDFs (Unterstrich-Praefix => sortieren nach oben)
    try {
      if (mietBuffers.length)    fs.writeFileSync(path.join(targetDir, '_Alle_Leihvertraege.pdf'), await mergePdfBuffers(mietBuffers));
      if (empfangBuffers.length) fs.writeFileSync(path.join(targetDir, '_Alle_Empfangsbestaetigungen.pdf'), await mergePdfBuffers(empfangBuffers));
    } catch (e) {
      errors.push(`Sammel-PDF: ${e.message}`);
    }

    triggerSync();
    shell.openPath(targetDir);
    return { success:true, folder:targetDir, created: mietBuffers.length, errors };
  });

  // Serienrueckgabe: mehrere aktive Ausleihen auf einmal zurueckgeben, PDFs in Ordner speichern
  ipcMain.handle('batch:return', async (event, payload) => {
    const { rentalIds, return_date, condition } = payload || {};
    if (!rentalIds || !rentalIds.length) return { success:false, error:'Keine Ausleihen ausgewaehlt.' };

    const dlg = await dialog.showOpenDialog({
      title: 'Zielordner fuer Rueckgabebescheinigungen waehlen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (dlg.canceled || !dlg.filePaths.length) return { success:false, canceled:true };
    const targetDir = dlg.filePaths[0];

    const settings = Settings.getAll();
    const total = rentalIds.length;
    const buffers = [];
    const errors = [];
    let done = 0;

    for (const rentalId of rentalIds) {
      try {
        const result  = Rentals.return(rentalId, { return_date, condition, condition_notes:'' });
        const rental  = Rentals.getById(rentalId);
        const rec     = Returns.getById(result.returnId);
        const buf     = await renderRueckgabeBuffer(rec, settings);
        const base    = `${safeName(rental.last_name)}_${safeName(rental.first_name)}_${safeName(rental.asset_tag)}`;
        const outPath = path.join(targetDir, `Rueckgabe_${base}.pdf`);
        fs.writeFileSync(outPath, buf);
        Returns.updatePdf(result.returnId, outPath);
        buffers.push(buf);
      } catch (e) { errors.push(e.message); }
      done++;
      event.sender.send('batch:return:progress', { done, total });
    }

    try {
      if (buffers.length)
        fs.writeFileSync(path.join(targetDir, '_Alle_Rueckgabebescheinigungen.pdf'), await mergePdfBuffers(buffers));
    } catch (e) { errors.push(`Sammel-PDF: ${e.message}`); }

    triggerSync();
    shell.openPath(targetDir);
    return { success:true, folder:targetDir, created:buffers.length, errors };
  });

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
    fs.writeFileSync(r.filePath, buildCsv(['Nachname','Vorname','Klasse','Typ','Moin-Benutzername','Strasse','PLZ','Ort','Eltern-Email','Eltern-Telefon','Notizen'],
      rows.map(s=>({'Nachname':s.last_name,'Vorname':s.first_name,'Klasse':s.class,'Typ':s.borrower_type==='lehrer'?'Lehrer':'Schueler','Moin-Benutzername':s.moin_username,'Strasse':s.street||'','PLZ':s.plz||'','Ort':s.city||'','Eltern-Email':s.guardian_email,'Eltern-Telefon':s.guardian_phone,'Notizen':s.notes}))), 'utf8');
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
      try { Students.create({last_name:last,first_name:first,class:cls,borrower_type:typ,moin_username:rec['Moin-Benutzername']||'',street:rec['Strasse']||rec['Straße']||'',plz:rec['PLZ']||'',city:rec['Ort']||'',guardian_email:rec['Eltern-Email']||'',guardian_phone:rec['Eltern-Telefon']||'',notes:rec['Notizen']||''}); imported++; }
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
    fs.writeFileSync(r.filePath, buildCsv(['Nachname','Vorname','Klasse','Typ','Moin-Benutzername','Strasse','PLZ','Ort','Eltern-Email','Eltern-Telefon','Notizen'],[{Nachname:'Mustermann',Vorname:'Max',Klasse:'9b',Typ:'Schueler','Moin-Benutzername':'max.mustermann',Strasse:'Musterstraße 12',PLZ:'27432',Ort:'Bremervörde','Eltern-Email':'eltern@schule.de','Eltern-Telefon':'04762 12345',Notizen:''}]), 'utf8');
    return {success:true};
  });
  ipcMain.handle('csv:template:ipads', async () => {
    const r = await dialog.showSaveDialog({ title:'Vorlage speichern', defaultPath:path.join(app.getPath('documents'),'ipads-vorlage.csv'), filters:[{name:'CSV',extensions:['csv']}] });
    if (r.canceled) return {success:false};
    fs.writeFileSync(r.filePath, buildCsv(['Nummer','Modell','Seriennummer','Notizen'],[{Nummer:'iPad-001',Modell:'iPad 10. Generation (64 GB, Wi-Fi)',Seriennummer:'FXXXXXXXXXXX',Notizen:''}]), 'utf8');
    return {success:true};
  });

  // Zuweisungsliste importieren: Nachname;Vorname;Klasse;iPad-Nummer;Ausleihdatum
  ipcMain.handle('csv:rentals:import', async (event, payload) => {
    const { lent_date: defaultDate, due_date } = payload || {};
    const r = await dialog.showOpenDialog({ title:'Zuweisungsliste importieren', filters:[{name:'CSV',extensions:['csv','txt']}], properties:['openFile'] });
    if (r.canceled) return {success:false,canceled:true};

    const records = parseCsv(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!records.length) return {success:true,imported:0,skipped:0,errors:[]};

    const dlg = await dialog.showOpenDialog({ title:'Zielordner fuer Leihvertraege waehlen', properties:['openDirectory','createDirectory'] });
    if (dlg.canceled || !dlg.filePaths.length) return {success:false,canceled:true};
    const targetDir = dlg.filePaths[0];

    const settings = Settings.getAll();
    const total = records.length;
    const mietBuffers = [];
    const errors = [];
    let imported = 0, skipped = 0;

    for (const rec of records) {
      const last     = (rec['Nachname']     || rec['nachname']     || '').trim();
      const first    = (rec['Vorname']      || rec['vorname']      || '').trim();
      const cls      = (rec['Klasse']       || rec['klasse']       || '').trim();
      // Spaltenname "Asset-Tag" (primär) mit Fallback auf "iPad-Nummer"
      const assetTag = (rec['Asset-Tag'] || rec['asset-tag'] || rec['iPad-Nummer'] || rec['ipad-nummer'] || '').trim();
      const rawDate  = (rec['Ausleihdatum'] || rec['ausleihdatum'] || '').trim();

      if (!last || !first || !cls || !assetTag) { skipped++; continue; }

      // Datum parsen: TT.MM.JJJJ oder JJJJ-MM-TT; Fallback auf defaultDate
      let lentDate = defaultDate;
      if (rawDate) {
        const deDm = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (deDm) lentDate = `${deDm[3]}-${deDm[2].padStart(2,'0')}-${deDm[1].padStart(2,'0')}`;
        else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) lentDate = rawDate;
      }
      if (!lentDate) { errors.push(`${last}, ${first}: Kein gültiges Ausleihdatum.`); skipped++; continue; }

      try {
        // Person suchen – nur bestehende Einträge, nicht automatisch anlegen
        const students = Students.search(last).filter(s => s.last_name === last && s.first_name === first);
        if (!students.length) throw new Error(`Person nicht gefunden – bitte zuerst in der Personenverwaltung anlegen.`);
        const student = students[0];

        // iPad suchen – nur bestehende Einträge, nicht automatisch anlegen
        const ipad = iPads.getAll({ search: assetTag }).find(ip => ip.asset_tag === assetTag);
        if (!ipad) throw new Error(`iPad "${assetTag}" nicht gefunden – bitte zuerst im Inventar anlegen.`);
        if (ipad.status !== 'available') throw new Error(`iPad "${assetTag}" ist nicht verfügbar (Status: ${ipad.status}).`);

        const rentalId = Rentals.create({ ipad_id:ipad.id, student_id:student.id, lent_date:lentDate, due_date:due_date||null, condition_at_lend:'gut', notes:'CSV-Import' });
        const rental   = Rentals.getById(rentalId);
        const buf      = await renderMietvertragBuffer(rental, settings);
        const base     = `${safeName(rental.last_name)}_${safeName(rental.first_name)}_${safeName(rental.asset_tag)}`;
        const outPath  = path.join(targetDir, `Leihvertrag_${base}.pdf`);
        fs.writeFileSync(outPath, buf);
        Rentals.updatePdf(rentalId, outPath);
        mietBuffers.push(buf);
        imported++;
      } catch (e) {
        errors.push(`${last}, ${first} (${assetTag}): ${e.message}`);
        skipped++;
      }
      event.sender.send('csv:rentals:import:progress', { done: imported + skipped, total });
    }

    if (mietBuffers.length) {
      try {
        const mergedPath = path.join(targetDir, '_Alle_Leihvertraege_Import.pdf');
        fs.writeFileSync(mergedPath, await mergePdfBuffers(mietBuffers));
      } catch (e) { errors.push(`Sammel-PDF: ${e.message}`); }
      shell.openPath(targetDir);
    }

    triggerSync();
    return { success:true, imported, skipped, errors, folder:targetDir };
  });

  // WebDAV
  ipcMain.handle('webdav:test', async (_, params) => {
    // params may be passed directly from the UI (unsaved form values)
    const s = params || Settings.getAll();
    try { const files = await testConnection(s); return {success:true, files}; }
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
