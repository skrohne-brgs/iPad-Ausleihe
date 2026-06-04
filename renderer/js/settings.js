'use strict';

async function loadSettings() {
  const s = await window.api.getSettings();
  ['school_name','school_address','school_city','school_phone','school_email','rlsb'].forEach(k => {
    const el = document.getElementById(`s-${k}`);
    if (el) el.value = s[k] || '';
  });
  if (s.school_logo_path) showLogoPreview(s.school_logo_path);

  // WebDAV
  document.getElementById('webdav-enabled').checked = s.webdav_enabled === '1';
  document.getElementById('webdav-url').value        = s.webdav_url || '';
  document.getElementById('webdav-username').value   = s.webdav_username || '';
  document.getElementById('webdav-password').value   = s.webdav_password || '';
  document.getElementById('webdav-remote-path').value = s.webdav_remote_path || '/ipad-ausleihe/';
  const lastSync = s.webdav_last_sync;
  document.getElementById('webdav-last-sync').textContent =
    lastSync ? `Letzte Synchronisation: ${lastSync}` : 'Noch nicht synchronisiert.';
  toggleWebdavFields();
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  for (const [k, v] of fd.entries()) await window.api.setSetting(k, v);
  toast('Einstellungen gespeichert.', 'success');
});

document.getElementById('btn-select-logo').addEventListener('click', async () => {
  const p = await window.api.selectLogo();
  if (p) { showLogoPreview(p); toast('Logo gespeichert.', 'success'); }
});

function showLogoPreview(src) {
  const img = document.getElementById('logo-preview');
  img.src = 'file://' + src.replace(/\\/g, '/');
  img.style.display = 'block';
  img.onerror = () => { img.style.display = 'none'; };
}

// --- WebDAV ---

function toggleWebdavFields() {
  const enabled = document.getElementById('webdav-enabled').checked;
  document.getElementById('webdav-fields').style.display = enabled ? 'block' : 'none';
}

document.getElementById('webdav-enabled').addEventListener('change', toggleWebdavFields);

document.getElementById('btn-webdav-save').addEventListener('click', async () => {
  await window.api.setSetting('webdav_enabled',     document.getElementById('webdav-enabled').checked ? '1' : '0');
  await window.api.setSetting('webdav_url',          document.getElementById('webdav-url').value.trim());
  await window.api.setSetting('webdav_username',     document.getElementById('webdav-username').value.trim());
  await window.api.setSetting('webdav_password',     document.getElementById('webdav-password').value);
  await window.api.setSetting('webdav_remote_path',  document.getElementById('webdav-remote-path').value.trim() || '/ipad-ausleihe/');
  toast('WebDAV-Einstellungen gespeichert.', 'success');
});

document.getElementById('btn-webdav-test').addEventListener('click', async () => {
  const btn = document.getElementById('btn-webdav-test');
  btn.disabled = true;
  btn.textContent = 'Teste…';
  // Pass current form values directly so saving first is not required
  const params = {
    webdav_url:          document.getElementById('webdav-url').value.trim(),
    webdav_username:     document.getElementById('webdav-username').value.trim(),
    webdav_password:     document.getElementById('webdav-password').value,
    webdav_remote_path:  document.getElementById('webdav-remote-path').value.trim() || '/ipad-ausleihe/',
    webdav_enabled:      '1',
  };
  const res = await window.api.webdavTest(params);
  btn.disabled = false;
  btn.textContent = 'Verbindung testen';
  if (res.success) {
    toast('Verbindung erfolgreich!' + (res.files !== undefined ? ` ${res.files} Datei(en) im Verzeichnis.` : ''), 'success');
  } else {
    toast('Verbindung fehlgeschlagen: ' + res.error, 'error');
  }
});

document.getElementById('btn-webdav-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-webdav-sync');
  btn.disabled = true;
  btn.textContent = 'Synchronisiere…';
  const res = await window.api.webdavSync();
  btn.disabled = false;
  btn.textContent = 'Jetzt synchronisieren';
  if (res.success) {
    toast('Datenbank erfolgreich synchronisiert.', 'success');
    document.getElementById('webdav-last-sync').textContent =
      'Letzte Synchronisation: ' + new Date().toLocaleString('de-DE');
  } else {
    toast('Synchronisation fehlgeschlagen: ' + res.error, 'error');
  }
});

document.getElementById('btn-webdav-pw-toggle').addEventListener('click', () => {
  const pw  = document.getElementById('webdav-password');
  const btn = document.getElementById('btn-webdav-pw-toggle');
  if (pw.type === 'password') { pw.type = 'text';     btn.textContent = 'Verbergen'; }
  else                        { pw.type = 'password'; btn.textContent = 'Anzeigen';  }
});
