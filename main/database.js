'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'ipad-ausleihe.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  seedSettings();
  return db;
}

function backupToPath(destPath) {
  return db.backup(destPath);
}

function migrate() {
  const v = db.pragma('user_version', { simple: true });

  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ipads (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_tag   TEXT NOT NULL UNIQUE,
        model       TEXT NOT NULL,
        serial      TEXT NOT NULL UNIQUE,
        status      TEXT NOT NULL DEFAULT 'available',
        notes       TEXT DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS students (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name      TEXT NOT NULL,
        last_name       TEXT NOT NULL,
        class           TEXT NOT NULL,
        moin_username   TEXT DEFAULT '',
        guardian_email  TEXT DEFAULT '',
        guardian_phone  TEXT DEFAULT '',
        notes           TEXT DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS rentals (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        ipad_id             INTEGER NOT NULL REFERENCES ipads(id),
        student_id          INTEGER NOT NULL REFERENCES students(id),
        lent_date           TEXT NOT NULL,
        due_date            TEXT,
        condition_at_lend   TEXT NOT NULL DEFAULT 'gut',
        returned_date       TEXT,
        condition_at_return TEXT,
        status              TEXT NOT NULL DEFAULT 'active',
        contract_pdf        TEXT DEFAULT '',
        notes               TEXT DEFAULT '',
        created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS returns (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id       INTEGER NOT NULL REFERENCES rentals(id),
        return_date     TEXT NOT NULL,
        condition       TEXT NOT NULL,
        condition_notes TEXT DEFAULT '',
        receipt_pdf     TEXT DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS incident_reports (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id       INTEGER NOT NULL REFERENCES rentals(id),
        report_date     TEXT NOT NULL,
        incident_type   TEXT NOT NULL,
        description     TEXT NOT NULL,
        repair_cost     REAL,
        report_pdf      TEXT DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type  TEXT NOT NULL,
        entity      TEXT NOT NULL,
        entity_id   INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ipads_status       ON ipads(status);
      CREATE INDEX IF NOT EXISTS idx_rentals_status     ON rentals(status);
      CREATE INDEX IF NOT EXISTS idx_rentals_student_id ON rentals(student_id);
      CREATE INDEX IF NOT EXISTS idx_rentals_ipad_id    ON rentals(ipad_id);
      CREATE INDEX IF NOT EXISTS idx_students_class     ON students(class);
      CREATE INDEX IF NOT EXISTS idx_students_name      ON students(last_name, first_name);
    `);
    db.pragma('user_version = 1');
  }

  if (v < 2) {
    db.exec(`ALTER TABLE students ADD COLUMN borrower_type TEXT NOT NULL DEFAULT 'schueler'`);
    db.pragma('user_version = 2');
  }

  if (v < 3) {
    db.exec(`ALTER TABLE ipads ADD COLUMN rental_age_years INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE students ADD COLUMN guardian_name TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE students ADD COLUMN guardian_street TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE students ADD COLUMN guardian_plz TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE students ADD COLUMN guardian_city TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE rentals ADD COLUMN accessories TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE incident_reports ADD COLUMN police_reference TEXT DEFAULT ''`);
    db.exec(`ALTER TABLE incident_reports ADD COLUMN damage_types TEXT DEFAULT '[]'`);
    db.pragma('user_version = 3');
  }
}

function seedSettings() {
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seeds = [
    ['school_name', ''], ['school_address', ''], ['school_city', ''],
    ['school_phone', ''], ['school_email', ''], ['school_logo_path', ''],
    ['backup_dir', ''], ['setup_complete', '0'],
    ['webdav_enabled', '0'], ['webdav_url', ''], ['webdav_username', ''],
    ['webdav_password', ''], ['webdav_remote_path', '/ipad-ausleihe/'],
    ['webdav_last_sync', ''], ['rlsb', ''],
  ];
  for (const [k, v] of seeds) stmt.run(k, v);
}

// ---------------------------------------------------------------------------
const Settings = {
  get(key) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : null; },
  getAll() { return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value])); },
  set(key, value) { db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value ?? '')); },
};

// ---------------------------------------------------------------------------
const iPads = {
  getAll(filter = {}) {
    let sql = `SELECT i.*,(SELECT COUNT(*) FROM rentals r WHERE r.ipad_id=i.id AND r.status='active') AS active_rentals FROM ipads i WHERE 1=1`;
    const p = [];
    if (filter.status) { sql += ' AND i.status=?'; p.push(filter.status); }
    if (filter.search) { sql += ' AND (i.asset_tag LIKE ? OR i.model LIKE ? OR i.serial LIKE ?)'; p.push(`%${filter.search}%`,`%${filter.search}%`,`%${filter.search}%`); }
    sql += ' ORDER BY i.asset_tag';
    return db.prepare(sql).all(...p);
  },
  getById(id) { return db.prepare('SELECT * FROM ipads WHERE id=?').get(id); },
  getAvailable() { return db.prepare("SELECT * FROM ipads WHERE status='available' ORDER BY asset_tag").all(); },
  // Fuer Serienausleihe: fabrikneue Geraete (0 Jahre Verleihdauer) zuerst, dann nach Nummer.
  getAvailableSorted() { return db.prepare("SELECT * FROM ipads WHERE status='available' ORDER BY rental_age_years ASC, asset_tag ASC").all(); },
  create(data) {
    const r = db.prepare('INSERT INTO ipads (asset_tag,model,serial,notes,rental_age_years) VALUES (@asset_tag,@model,@serial,@notes,@rental_age_years)').run({ notes:'', rental_age_years:0, ...data });
    AuditLog.record('CREATE','ipad',r.lastInsertRowid,`iPad "${data.asset_tag}" (${data.model}) hinzugefuegt`);
    return r.lastInsertRowid;
  },
  update(id, data) {
    db.prepare(`UPDATE ipads SET asset_tag=@asset_tag,model=@model,serial=@serial,notes=@notes,rental_age_years=@rental_age_years,updated_at=datetime('now','localtime') WHERE id=@id`).run({rental_age_years:0,...data,id});
    AuditLog.record('UPDATE','ipad',id,`iPad "${data.asset_tag}" aktualisiert`);
  },
  updateStatus(id, status) { db.prepare("UPDATE ipads SET status=?,updated_at=datetime('now','localtime') WHERE id=?").run(status,id); },
  delete(id) {
    return db.transaction(() => {
      const ipad = this.getById(id);
      if (!ipad) throw new Error('iPad nicht gefunden.');
      const active = db.prepare("SELECT COUNT(*) AS c FROM rentals WHERE ipad_id=? AND status='active'").get(id);
      if (active.c > 0) throw new Error('iPad ist noch ausgeliehen. Bitte zuerst zurückgeben.');
      // Kaskade: Vorfälle → Rückgaben → Ausleihen → iPad
      const rentalIds = db.prepare('SELECT id FROM rentals WHERE ipad_id=?').all(id).map(r => r.id);
      for (const rid of rentalIds) {
        db.prepare('DELETE FROM incident_reports WHERE rental_id=?').run(rid);
        db.prepare('DELETE FROM returns WHERE rental_id=?').run(rid);
      }
      db.prepare('DELETE FROM rentals WHERE ipad_id=?').run(id);
      db.prepare('DELETE FROM ipads WHERE id=?').run(id);
      AuditLog.record('DELETE', 'ipad', id, `iPad "${ipad.asset_tag}" geloescht`);
    })();
  },
  deleteMany(ids) {
    return db.transaction(() => {
      let deleted = 0;
      for (const id of ids) {
        const ipad = this.getById(id);
        if (!ipad) continue;
        const active = db.prepare("SELECT COUNT(*) AS c FROM rentals WHERE ipad_id=? AND status='active'").get(id);
        if (active.c > 0) throw new Error(`iPad "${ipad.asset_tag}" ist noch ausgeliehen und kann nicht gelöscht werden.`);
        const rentalIds = db.prepare('SELECT id FROM rentals WHERE ipad_id=?').all(id).map(r => r.id);
        for (const rid of rentalIds) {
          db.prepare('DELETE FROM incident_reports WHERE rental_id=?').run(rid);
          db.prepare('DELETE FROM returns WHERE rental_id=?').run(rid);
        }
        db.prepare('DELETE FROM rentals WHERE ipad_id=?').run(id);
        db.prepare('DELETE FROM ipads WHERE id=?').run(id);
        AuditLog.record('DELETE', 'ipad', id, `iPad "${ipad.asset_tag}" geloescht`);
        deleted++;
      }
      return deleted;
    })();
  },
};

// ---------------------------------------------------------------------------
const Students = {
  getAll(filter = {}) {
    let sql = `SELECT s.*,(SELECT COUNT(*) FROM rentals r WHERE r.student_id=s.id AND r.status='active') AS active_rentals FROM students s WHERE 1=1`;
    const p = [];
    if (filter.borrower_type) { sql += ' AND s.borrower_type=?'; p.push(filter.borrower_type); }
    if (filter.search) { sql += ' AND (s.last_name LIKE ? OR s.first_name LIKE ? OR s.class LIKE ? OR s.moin_username LIKE ?)'; p.push(`%${filter.search}%`,`%${filter.search}%`,`%${filter.search}%`,`%${filter.search}%`); }
    sql += ' ORDER BY s.last_name,s.first_name';
    return db.prepare(sql).all(...p);
  },
  getById(id) { return db.prepare('SELECT * FROM students WHERE id=?').get(id); },
  // Distinct-Klassenliste mit Anzahl der Personen ohne aktive Ausleihe (fuer Serienausleihe).
  getClasses() {
    return db.prepare(`
      SELECT s.class AS class,
             COUNT(*) AS total,
             SUM(CASE WHEN (SELECT COUNT(*) FROM rentals r WHERE r.student_id=s.id AND r.status='active')=0 THEN 1 ELSE 0 END) AS available
      FROM students s
      WHERE s.class IS NOT NULL AND s.class<>''
      GROUP BY s.class
      ORDER BY s.class
    `).all();
  },
  // Personen ausgewaehlter Klassen, die aktuell kein iPad ausgeliehen haben.
  getByClassesAvailable(classes) {
    if (!classes || !classes.length) return [];
    const placeholders = classes.map(() => '?').join(',');
    return db.prepare(`
      SELECT s.* FROM students s
      WHERE s.class IN (${placeholders})
        AND (SELECT COUNT(*) FROM rentals r WHERE r.student_id=s.id AND r.status='active')=0
      ORDER BY s.class, s.last_name, s.first_name
    `).all(...classes);
  },
  search(query) {
    return db.prepare(`SELECT * FROM students WHERE last_name LIKE ? OR first_name LIKE ? OR class LIKE ? OR moin_username LIKE ? ORDER BY last_name,first_name LIMIT 20`
    ).all(`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`);
  },
  create(data) {
    const r = db.prepare(`INSERT INTO students (first_name,last_name,class,moin_username,guardian_email,guardian_phone,guardian_name,guardian_street,guardian_plz,guardian_city,notes,borrower_type) VALUES (@first_name,@last_name,@class,@moin_username,@guardian_email,@guardian_phone,@guardian_name,@guardian_street,@guardian_plz,@guardian_city,@notes,@borrower_type)`
    ).run({ moin_username:'',guardian_email:'',guardian_phone:'',guardian_name:'',guardian_street:'',guardian_plz:'',guardian_city:'',notes:'',borrower_type:'schueler', ...data });
    AuditLog.record('CREATE','student',r.lastInsertRowid,`${data.borrower_type==='lehrer'?'Lehrkraft':'Schueler'} ${data.last_name}, ${data.first_name} (${data.class}) hinzugefuegt`);
    return r.lastInsertRowid;
  },
  update(id, data) {
    db.prepare(`UPDATE students SET first_name=@first_name,last_name=@last_name,class=@class,moin_username=@moin_username,guardian_email=@guardian_email,guardian_phone=@guardian_phone,guardian_name=@guardian_name,guardian_street=@guardian_street,guardian_plz=@guardian_plz,guardian_city=@guardian_city,notes=@notes,borrower_type=@borrower_type WHERE id=@id`).run({guardian_name:'',guardian_street:'',guardian_plz:'',guardian_city:'',...data,id});
    AuditLog.record('UPDATE','student',id,`${data.last_name}, ${data.first_name} aktualisiert`);
  },
  delete(id) {
    return db.transaction(() => {
      const s = this.getById(id);
      if (!s) throw new Error('Person nicht gefunden.');
      const active = db.prepare("SELECT COUNT(*) AS c FROM rentals WHERE student_id=? AND status='active'").get(id);
      if (active.c > 0) throw new Error('Person hat noch aktive Ausleihen. Bitte zuerst zurückgeben.');
      const rentalIds = db.prepare('SELECT id FROM rentals WHERE student_id=?').all(id).map(r => r.id);
      for (const rid of rentalIds) {
        db.prepare('DELETE FROM incident_reports WHERE rental_id=?').run(rid);
        db.prepare('DELETE FROM returns WHERE rental_id=?').run(rid);
      }
      db.prepare('DELETE FROM rentals WHERE student_id=?').run(id);
      db.prepare('DELETE FROM students WHERE id=?').run(id);
      AuditLog.record('DELETE', 'student', id, `${s.last_name}, ${s.first_name} geloescht`);
    })();
  },
};

// ---------------------------------------------------------------------------
const rentalSelect = `SELECT r.*,s.first_name,s.last_name,s.class,s.moin_username,s.guardian_email,s.guardian_phone,s.guardian_name,s.guardian_street,s.guardian_plz,s.guardian_city,s.borrower_type,i.asset_tag,i.model,i.serial,i.rental_age_years FROM rentals r JOIN students s ON s.id=r.student_id JOIN ipads i ON i.id=r.ipad_id`;

const Rentals = {
  getAll(filter = {}) {
    let sql = rentalSelect + ' WHERE 1=1'; const p = [];
    if (filter.status)     { sql += ' AND r.status=?';     p.push(filter.status); }
    if (filter.student_id) { sql += ' AND r.student_id=?'; p.push(filter.student_id); }
    if (filter.ipad_id)    { sql += ' AND r.ipad_id=?';    p.push(filter.ipad_id); }
    if (filter.search)     { sql += ' AND (s.last_name LIKE ? OR s.first_name LIKE ? OR i.asset_tag LIKE ?)'; p.push(`%${filter.search}%`,`%${filter.search}%`,`%${filter.search}%`); }
    sql += ' ORDER BY r.created_at DESC';
    return db.prepare(sql).all(...p);
  },
  getById(id) { return db.prepare(rentalSelect+' WHERE r.id=?').get(id); },
  create(data) {
    return db.transaction(() => {
      const r = db.prepare(`INSERT INTO rentals (ipad_id,student_id,lent_date,due_date,condition_at_lend,accessories,notes) VALUES (@ipad_id,@student_id,@lent_date,@due_date,@condition_at_lend,@accessories,@notes)`
      ).run({ due_date:null,condition_at_lend:'gut',accessories:'',notes:'', ...data });
      iPads.updateStatus(data.ipad_id,'rented');
      const id = r.lastInsertRowid;
      const rental = this.getById(id);
      AuditLog.record('LEND','rental',id,`iPad ${rental.asset_tag} an ${rental.last_name}, ${rental.first_name} (${rental.class}) ausgeliehen`);
      return id;
    })();
  },
  updatePdf(id, p) { db.prepare('UPDATE rentals SET contract_pdf=? WHERE id=?').run(p,id); },
  return(id, data) {
    return db.transaction(() => {
      const rental = this.getById(id);
      const newStatus = data.condition==='verloren'?'lost':data.condition==='defekt'?'defect':'returned';
      db.prepare(`UPDATE rentals SET status=@status,returned_date=@return_date,condition_at_return=@condition WHERE id=@id`
      ).run({ status:newStatus,return_date:data.return_date,condition:data.condition,id });
      iPads.updateStatus(rental.ipad_id, data.condition==='verloren'?'lost':data.condition==='defekt'?'defect':'available');
      const ret = db.prepare('INSERT INTO returns (rental_id,return_date,condition,condition_notes) VALUES (?,?,?,?)'
      ).run(id,data.return_date,data.condition,data.condition_notes||'');
      AuditLog.record('RETURN','rental',id,`iPad ${rental.asset_tag} von ${rental.last_name}, ${rental.first_name} zurueckgegeben (${data.condition})`);
      return { rentalId:id, returnId:ret.lastInsertRowid };
    })();
  },
};

// ---------------------------------------------------------------------------
const Returns = {
  getById(id) {
    return db.prepare(`SELECT ret.*,r.ipad_id,r.student_id,r.lent_date,s.first_name,s.last_name,s.class,s.moin_username,s.guardian_email,s.guardian_phone,s.guardian_name,s.guardian_street,s.guardian_plz,s.guardian_city,s.borrower_type,i.asset_tag,i.model,i.serial FROM returns ret JOIN rentals r ON r.id=ret.rental_id JOIN students s ON s.id=r.student_id JOIN ipads i ON i.id=r.ipad_id WHERE ret.id=?`).get(id);
  },
  updatePdf(id, p) { db.prepare('UPDATE returns SET receipt_pdf=? WHERE id=?').run(p,id); },
};

// ---------------------------------------------------------------------------
const IncidentReports = {
  create(data) {
    const r = db.prepare(`INSERT INTO incident_reports (rental_id,report_date,incident_type,description,repair_cost,police_reference,damage_types) VALUES (@rental_id,@report_date,@incident_type,@description,@repair_cost,@police_reference,@damage_types)`
    ).run({ repair_cost:null, police_reference:'', damage_types:'[]', ...data });
    const rental = Rentals.getById(data.rental_id);
    const isVerlust = data.incident_type === 'verlust';
    const newRentalStatus = isVerlust ? 'lost' : 'defect';
    const newIpadStatus   = isVerlust ? 'lost' : 'defect';
    db.prepare("UPDATE rentals SET status=? WHERE id=?").run(newRentalStatus, data.rental_id);
    iPads.updateStatus(rental.ipad_id, newIpadStatus);
    AuditLog.record('REPORT','rental',data.rental_id,`${isVerlust?'Verlust':'Defekt'} gemeldet fuer iPad ${rental.asset_tag}`);
    return r.lastInsertRowid;
  },
  getById(id) {
    return db.prepare(`SELECT ir.*,r.ipad_id,r.student_id,r.lent_date,s.first_name,s.last_name,s.class,s.moin_username,s.guardian_email,s.guardian_phone,s.guardian_name,s.guardian_street,s.guardian_plz,s.guardian_city,s.borrower_type,i.asset_tag,i.model,i.serial FROM incident_reports ir JOIN rentals r ON r.id=ir.rental_id JOIN students s ON s.id=r.student_id JOIN ipads i ON i.id=r.ipad_id WHERE ir.id=?`).get(id);
  },
  updatePdf(id, p) { db.prepare('UPDATE incident_reports SET report_pdf=? WHERE id=?').run(p,id); },
};

// ---------------------------------------------------------------------------
const AuditLog = {
  record(event_type,entity,entity_id,description) {
    db.prepare('INSERT INTO audit_log (event_type,entity,entity_id,description) VALUES (?,?,?,?)').run(event_type,entity,entity_id,description);
  },
  getAll(filter = {}) {
    let sql='SELECT * FROM audit_log WHERE 1=1'; const p=[];
    if (filter.event_type) { sql+=' AND event_type=?'; p.push(filter.event_type); }
    if (filter.from_date)  { sql+=' AND created_at>=?'; p.push(filter.from_date); }
    if (filter.to_date)    { sql+=' AND created_at<=?'; p.push(filter.to_date+' 23:59:59'); }
    sql+=' ORDER BY created_at DESC';
    if (filter.limit) { sql+=' LIMIT ?'; p.push(filter.limit); }
    return db.prepare(sql).all(...p);
  },
};

// ---------------------------------------------------------------------------
const Dashboard = {
  getStats() {
    const q = sql => db.prepare(sql).get();
    return {
      total:     q('SELECT COUNT(*) AS c FROM ipads').c,
      available: q("SELECT COUNT(*) AS c FROM ipads WHERE status='available'").c,
      rented:    q("SELECT COUNT(*) AS c FROM ipads WHERE status='rented'").c,
      defect:    q("SELECT COUNT(*) AS c FROM ipads WHERE status='defect'").c,
      lost:      q("SELECT COUNT(*) AS c FROM ipads WHERE status='lost'").c,
      overdue:   q("SELECT COUNT(*) AS c FROM rentals WHERE status='active' AND due_date IS NOT NULL AND due_date<date('now')").c,
      recentActivity: AuditLog.getAll({ limit:10 }),
    };
  },
};

module.exports = { initDatabase, backupToPath, Settings, iPads, Students, Rentals, Returns, IncidentReports, AuditLog, Dashboard };
