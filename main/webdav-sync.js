'use strict';
const { createClient } = require('webdav');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let syncTimer = null;

function makeClient(s) {
  if (s.webdav_enabled !== '1' || !s.webdav_url) return null;
  const opts = {};
  if (s.webdav_username) opts.username = s.webdav_username;
  if (s.webdav_password) opts.password = s.webdav_password;
  return createClient(s.webdav_url, opts);
}

function remotePath(s) {
  return (s.webdav_remote_path || '/').replace(/\/?$/, '/') + 'ipad-ausleihe.db';
}

async function testConnection(s) {
  const client = makeClient(s);
  if (!client) throw new Error('WebDAV ist nicht konfiguriert oder deaktiviert.');
  await client.getDirectoryContents(s.webdav_remote_path || '/');
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
