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

// Creates the remote directory if it doesn't exist yet.
// Silently ignores errors when the directory already exists (405/409).
async function ensureRemoteDir(client, remoteDir) {
  try {
    await client.createDirectory(remoteDir);
  } catch (e) {
    const msg = e.message || '';
    // 405 Method Not Allowed = already exists on some servers
    // 409 Conflict = already exists or parent missing (we'll accept both)
    if (!msg.includes('405') && !msg.includes('409')) throw e;
  }
}

// Returns the number of files in the remote directory on success; throws on failure.
async function testConnection(s) {
  const client = makeClient(s);
  if (!client) throw new Error('WebDAV ist nicht konfiguriert (keine URL angegeben).');
  const remoteDir = s.webdav_remote_path || '/';
  let contents;
  try {
    contents = await client.getDirectoryContents(remoteDir);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('401') || msg.includes('Unauthorized'))
      throw new Error('Authentifizierung fehlgeschlagen (401). Bitte Benutzername/Passwort prüfen.');
    if (msg.includes('403') || msg.includes('Forbidden'))
      throw new Error('Zugriff verweigert (403). Bitte Pfad und Berechtigungen prüfen.');
    if (msg.includes('404') || msg.includes('Not Found')) {
      // Directory doesn't exist yet — try to create it, then list again
      try {
        await ensureRemoteDir(client, remoteDir);
        contents = await client.getDirectoryContents(remoteDir);
      } catch (e2) {
        throw new Error(`Verzeichnis "${remoteDir}" nicht gefunden und konnte nicht erstellt werden: ${e2.message}`);
      }
    } else if (msg.includes('certificate') || msg.includes('self-signed') || msg.includes('CERT_') || msg.includes('ERR_CERT')) {
      throw new Error('TLS-Zertifikatsfehler. Die App akzeptiert selbst-signierte Zertifikate – prüfen Sie ob die URL korrekt ist (https://).');
    } else if (msg.includes('ECONNREFUSED')) {
      throw new Error('Verbindung abgelehnt. Ist der WebDAV-Server erreichbar?');
    } else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      throw new Error('Host nicht gefunden. Bitte URL prüfen.');
    } else {
      throw e;
    }
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
  // Ensure the remote directory exists before uploading
  try { await ensureRemoteDir(client, s.webdav_remote_path || '/'); } catch {}
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
