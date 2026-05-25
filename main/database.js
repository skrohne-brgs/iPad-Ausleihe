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
}

function seedSettings() {
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seeds = [
    ['school_name', ''],
    ['school_address', ''],
    ['school_city', ''],
    ['school_phone', ''],
    ['school_email', ''],
    ['school_logo_path', ''],
    ['backup_dir', ''],
    ['setup_complete', '0'],
  ];
  for (const [k, v] of seeds) stmt.run(k, v);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const Settings = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  getAll() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
  set(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''));
  },
};

// ---------------------------------------------------------------------------
// iPads
// ---------------------------------------------------------------------------
const iPads = {
  getAll(filter = {}) {
    let sql = `SELECT i.*,
      (SELECT COUNT(*) FROM rentals r WHERE r.ipad_id = i.id AND r.status = 'active') AS active_rentals
      FROM ipads i WHERE 1=1`;
    const p = [];
    if (filter.status) { sql += ' AND i.status = ?'; p.push(filter.status); }
    if (filter.search) {
      sql += ' AND (i.asset_tag LIKE ? OR i.model LIKE ? OR i.serial LIKE ?)';
      p.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    sql += ' ORDER BY i.asset_tag';
    return db.prepare(sql).all(...p);
  },
  getById(id) { return db.prepare('SELECT * FROM ipads WHERE id = ?').get(id); },
  getAvailable() {
    return db.prepare("SELECT * FROM ipads WHERE status = 'available' ORDER BY asset_tag").all();
  },
  create(data) {
    const r = db.prepare(
      'INSERT INTO ipads (asset_tag, model, serial, notes) VALUES (@asset_tag, @model, @serial, @notes)'
    ).run({ notes: '', ...data });
    AuditLog.record('CREATE', 'ipad', r.lastInsertRowid, `iPad "${data.asset_tag}" (${data.model}) hinzugefuegt`);
    return r.lastInsertRowid;
  },
  update(id, data) {
    db.prepare(`UPDATE ipads SET asset_tag=@asset_tag, model=@model, serial=@serial, notes=@notes,
      updated_at=datetime('now','localtime') WHERE id=@id`).run({ ...data, id });
    AuditLog.record('UPDATE', 'ipad', id, `iPad "${data.asset_tag}" aktualisiert`);
  },
  updateStatus(id, status) {
    db.prepare("UPDATE ipads SET status=?, updated_at=datetime('now','localtime') WHERE id=?").run(status, id);
  },
  delete(id) {
    const ipad = this.getById(id);
    const active = db.prepare("SELECT COUNT(*) AS c FROM rentals WHERE ipad_id=? AND status='active'").get(id);
    if (active.c > 0) throw new Error('iPad ist noch ausgeliehen und kann nicht geloescht werden.');
    db.prepare('DELETE FROM ipads WHERE id=?').run(id);
    AuditLog.record('DELETE', 'ipad', id, `iPad "${ipad.asset_tag}" geloescht`);
  },
};

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
const Students = {
  getAll(filter = {}) {
    let sql = `SELECT s.*,
      (SELECT COUNT(*) FROM rentals r WHERE r.student_id = s.id AND r.status = 'active') AS active_rentals
      FROM students s WHERE 1=1`;
    const p = [];
    if (filter.class) { sql += ' AND s.class = ?'; p.push(filter.class); }
    if (filter.search) {
      sql += ' AND (s.last_name LIKE ? OR s.first_name LIKE ? OR s.class LIKE ? OR s.moin_username LIKE ?)';
      p.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    sql += ' ORDER BY s.last_name, s.first_name';
    return db.prepare(sql).all(...p);
  },
  getById(id) { return db.prepare('SELECT * FROM students WHERE id=?').get(id); },
  search(query) {
    return db.prepare(`SELECT * FROM students
      WHERE last_name LIKE ? OR first_name LIKE ? OR class LIKE ? OR moin_username LIKE ?
      ORDER BY last_name, first_name LIMIT 20`
    ).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  },
  create(data) {
    const r = db.prepare(`INSERT INTO students
      (first_name, last_name, class, moin_username, guardian_email, guardian_phone, notes)
      VALUES (@first_name, @last_name, @class, @moin_username, @guardian_email, @guardian_phone, @notes)`
    ).run({ moin_username: '', guardian_email: '', guardian_phone: '', notes: '', ...data });
    AuditLog.record('CREATE', 'student', r.lastInsertRowid,
      `Schueler ${data.last_name}, ${data.first_name} (${data.class}) hinzugefuegt`);
    return r.lastInsertRowid;
  },
  update(id, data) {
    db.prepare(`UPDATE students SET first_name=@first_name, last_name=@last_name, class=@class,
      moin_username=@moin_username, guardian_email=@guardian_email, guardian_phone=@guardian_phone,
      notes=@notes WHERE id=@id`).run({ ...data, id });
    AuditLog.record('UPDATE', 'student', id, `Schueler ${data.last_name}, ${data.first_name} aktualisiert`);
  },
  delete(id) {
    const s = this.getById(id);
    const active = db.prepare("SELECT COUNT(*) AS c FROM rentals WHERE student_id=? AND status='active'").get(id);
    if (active.c > 0) throw new Error('Schueler hat noch aktive Ausleihen und kann nicht geloescht werden.');
    db.prepare('DELETE FROM students WHERE id=?').run(id);
    AuditLog.record('DELETE', 'student', id, `Schueler ${s.last_name}, ${s.first_name} geloescht`);
  },
};

// ---------------------------------------------------------------------------
// Rentals
// ---------------------------------------------------------------------------
const rentalSelect = `SELECT r.*,
  s.first_name, s.last_name, s.class, s.moin_username, s.guardian_email, s.guardian_phone,
  i.asset_tag, i.model, i.serial
  FROM rentals r
  JOIN students s ON s.id = r.student_id
  JOIN ipads    i ON i.id = r.ipad_id`;

const Rentals = {
  getAll(filter = {}) {
    let sql = rentalSelect + ' WHERE 1=1';
    const p = [];
    if (filter.status)     { sql += ' AND r.status = ?';     p.push(filter.status); }
    if (filter.student_id) { sql += ' AND r.student_id = ?'; p.push(filter.student_id); }
    if (filter.ipad_id)    { sql += ' AND r.ipad_id = ?';    p.push(filter.ipad_id); }
    if (filter.search) {
      sql += ' AND (s.last_name LIKE ? OR s.first_name LIKE ? OR i.asset_tag LIKE ?)';
      p.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    sql += ' ORDER BY r.created_at DESC';
    return db.prepare(sql).all(...p);
  },
  getById(id) {
    return db.prepare(rentalSelect + ' WHERE r.id = ?').get(id);
  },
  create(data) {
    return db.transaction(() => {
      const r = db.prepare(`INSERT INTO rentals
        (ipad_id, student_id, lent_date, due_date, condition_at_lend, notes)
        VALUES (@ipad_id, @student_id, @lent_date, @due_date, @condition_at_lend, @notes)`
      ).run({ due_date: null, condition_at_lend: 'gut', notes: '', ...data });
      iPads.updateStatus(data.ipad_id, 'rented');
      const id = r.lastInsertRowid;
      const rental = this.getById(id);
      AuditLog.record('LEND', 'rental', id,
        `iPad ${rental.asset_tag} an ${rental.last_name}, ${rental.first_name} (${rental.class}) ausgeliehen`);
      return id;
    })();
  },
  updatePdf(id, pdfPath) {
    db.prepare('UPDATE rentals SET contract_pdf=? WHERE id=?').run(pdfPath, id);
  },
  return(id, data) {
    return db.transaction(() => {
      const rental = this.getById(id);
      const newStatus = data.condition === 'verloren' ? 'lost'
        : data.condition === 'defekt' ? 'defect' : 'returned';
      db.prepare(`UPDATE rentals SET status=@status, returned_date=@return_date,
        condition_at_return=@condition WHERE id=@id`
      ).run({ status: newStatus, return_date: data.return_date, condition: data.condition, id });
      const ipadStatus = data.condition === 'verloren' ? 'lost'
        : data.condition === 'defekt' ? 'defect' : 'available';
      iPads.updateStatus(rental.ipad_id, ipadStatus);
      const ret = db.prepare(
        'INSERT INTO returns (rental_id, return_date, condition, condition_notes) VALUES (?,?,?,?)'
      ).run(id, data.return_date, data.condition, data.condition_notes || '');
      AuditLog.record('RETURN', 'rental', id,
        `iPad ${rental.asset_tag} von ${rental.last_name}, ${rental.first_name} zurueckgegeben (Zustand: ${data.condition})`);
      return { rentalId: id, returnId: ret.lastInsertRowid };
    })();
  },
};

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------
const Returns = {
  getById(id) {
    return db.prepare(`SELECT ret.*, r.ipad_id, r.student_id, r.lent_date,
      s.first_name, s.last_name, s.class, s.moin_username, s.guardian_email, s.guardian_phone,
      i.asset_tag, i.model, i.serial
      FROM returns ret
      JOIN rentals r ON r.id = ret.rental_id
      JOIN students s ON s.id = r.student_id
      JOIN ipads i ON i.id = r.ipad_id
      WHERE ret.id = ?`).get(id);
  },
  updatePdf(id, pdfPath) {
    db.prepare('UPDATE returns SET receipt_pdf=? WHERE id=?').run(pdfPath, id);
  },
};

// ---------------------------------------------------------------------------
// Incident Reports
// ---------------------------------------------------------------------------
const IncidentReports = {
  create(data) {
    const r = db.prepare(`INSERT INTO incident_reports
      (rental_id, report_date, incident_type, description, repair_cost)
      VALUES (@rental_id, @report_date, @incident_type, @description, @repair_cost)`
    ).run({ repair_cost: null, ...data });
    const rental = Rentals.getById(data.rental_id);
    AuditLog.record('REPORT', 'rental', data.rental_id,
      `${data.incident_type === 'verlust' ? 'Verlust' : 'Defekt'} gemeldet fuer iPad ${rental.asset_tag}`);
    return r.lastInsertRowid;
  },
  getById(id) {
    return db.prepare(`SELECT ir.*, r.ipad_id, r.student_id, r.lent_date,
      s.first_name, s.last_name, s.class, s.moin_username, s.guardian_email, s.guardian_phone,
      i.asset_tag, i.model, i.serial
      FROM incident_reports ir
      JOIN rentals r ON r.id = ir.rental_id
      JOIN students s ON s.id = r.student_id
      JOIN ipads i ON i.id = r.ipad_id
      WHERE ir.id = ?`).get(id);
  },
  updatePdf(id, pdfPath) {
    db.prepare('UPDATE incident_reports SET report_pdf=? WHERE id=?').run(pdfPath, id);
  },
};

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------
const AuditLog = {
  record(event_type, entity, entity_id, description) {
    db.prepare(
      'INSERT INTO audit_log (event_type, entity, entity_id, description) VALUES (?,?,?,?)'
    ).run(event_type, entity, entity_id, description);
  },
  getAll(filter = {}) {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const p = [];
    if (filter.event_type) { sql += ' AND event_type = ?'; p.push(filter.event_type); }
    if (filter.from_date)  { sql += ' AND created_at >= ?'; p.push(filter.from_date); }
    if (filter.to_date)    { sql += ' AND created_at <= ?'; p.push(filter.to_date + ' 23:59:59'); }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) { sql += ' LIMIT ?'; p.push(filter.limit); }
    return db.prepare(sql).all(...p);
  },
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
const Dashboard = {
  getStats() {
    const q = (sql) => db.prepare(sql).get();
    return {
      total:     q('SELECT COUNT(*) AS c FROM ipads').c,
      available: q("SELECT COUNT(*) AS c FROM ipads WHERE status='available'").c,
      rented:    q("SELECT COUNT(*) AS c FROM ipads WHERE status='rented'").c,
      defect:    q("SELECT COUNT(*) AS c FROM ipads WHERE status='defect'").c,
      lost:      q("SELECT COUNT(*) AS c FROM ipads WHERE status='lost'").c,
      overdue:   q("SELECT COUNT(*) AS c FROM rentals WHERE status='active' AND due_date IS NOT NULL AND due_date < date('now')").c,
      recentActivity: AuditLog.getAll({ limit: 10 }),
    };
  },
};

module.exports = { initDatabase, Settings, iPads, Students, Rentals, Returns, IncidentReports, AuditLog, Dashboard };
