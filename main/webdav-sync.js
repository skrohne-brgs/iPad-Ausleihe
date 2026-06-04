'use strict';
const { createClient } = require('webdav');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let syncTimer = null;

// Builds a webdav client. HTTPS self-signed certs are accepted so that school
// intranet servers (which often lack a CA-signed cert) work out of the box.
function makeClient(s) {
  if (!s.webdav_url) return null;
  const opts = {};
  if (s.webdav_username) opts.username = s.webdav_username;
  if (s.webdav_password) opts.password = s.webdav_password;
  if (s.webdav_url.startsWith('https://')) {
    opts.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return createClient(s.webdav_url.replace(/\/$/, ''), opts);
}

function remotePath(s) {
  return (s.webdav_remote_path || '/').replace(/\/?$/, '/') + 'ipad-ausleihe.db';
}

// Returns the number of files in the remote directory on success; throws on failure.
async function testConnection(s) {
  const client = makeClient(s);
  if (!client) throw new Error('WebDAV ist nicht konfiguriert (keine URL angegeben).');
  let contents;
  try {
    contents = await client.getDirectoryContents(s.webdav_remote_path || '/');
  } catch (e) {
    // Provide a more useful error message than the raw axios/fetch error
    const msg = e.message || '';
    if (msg.includes('401') || msg.includes('Unauthorized'))
      throw new Error('Authentifizierung fehlgeschlagen (401). Bitte Benutzername/Passwort prüfen.');
    if (msg.includes('403') || msg.includes('Forbidden'))
      throw new Error('Zugriff verweigert (403). Bitte Pfad und Berechtigungen prüfen.');
    if (msg.includes('404') || msg.includes('Not Found'))
      throw new Error('Verzeichnis nicht gefunden (404). Bitte Remote-Pfad prüfen.');
    if (msg.includes('ECONNREFUSED'))
      throw new Error('Verbindung abgelehnt. Ist der WebDAV-Server erreichbar?');
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo'))
      throw new Error('Host nicht gefunden. Bitte URL prüfen.');
    throw e;
  }
  return Array.isArray(contents) ? contents.length : 0;
}

async function uploadDb(s, backupFn) {
  const client = makeClient(s);
  if (!client) return;
  const tmp = path.join(app.getPath('temp'), 'ipad-sync-snapshot.db');
  await backupFn(tmp);
  const buf = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch {}
  await client.putFileContents(remotePath(s), buf, { overwrite: true });
}

async function downloadDb(s) {
  const client = makeClient(s);
  if (!client) return null;
  try {
    const buf = await client.getFileContents(remotePath(s));
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

function scheduleUpload(s, backupFn, onResult) {
  if (s.webdav_enabled !== '1') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await uploadDb(s, backupFn);
      onResult(null);
    } catch (e) {
      onResult(e);
    }
  }, 8000);
}

module.exports = { testConnection, uploadDb, downloadDb, scheduleUpload };
