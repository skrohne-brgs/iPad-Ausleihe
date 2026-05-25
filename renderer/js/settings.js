'use strict';

async function loadSettings() {
  const s = await window.api.getSettings();
  ['school_name','school_address','school_city','school_phone','school_email'].forEach(k => {
    const el = document.getElementById(`s-${k}`);
    if (el) el.value = s[k] || '';
  });
  if (s.school_logo_path) showLogoPreview(s.school_logo_path);
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
  // Use the path directly – Electron allows local file access in renderer with file:// for userData paths
  // We encode the path for use in an img src
  img.src = 'file://' + src.replace(/\\/g, '/');
  img.style.display = 'block';
  img.onerror = () => { img.style.display = 'none'; };
}
