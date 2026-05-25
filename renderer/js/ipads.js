'use strict';

async function loadIpads() {
  const filter = {
    search: document.getElementById('ipad-search').value.trim() || undefined,
    status: document.getElementById('ipad-filter-status').value || undefined,
  };
  const ipads = await window.api.getIpads(filter);
  const tbody = document.getElementById('ipads-tbody');
  if (!ipads.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Keine iPads gefunden.</td></tr>';
    return;
  }
  tbody.innerHTML = ipads.map(ip => `
    <tr>
      <td><strong>${esc(ip.asset_tag)}</strong></td>
      <td>${esc(ip.model)}</td>
      <td style="font-family:monospace;font-size:.8rem">${esc(ip.serial)}</td>
      <td>${statusBadge(ip.status)}</td>
      <td>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${ip.status === 'available'
            ? `<button class="btn btn-sm btn-primary" onclick="quickLendIpad(${ip.id})">Ausleihen</button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="editIpad(${ip.id})">Bearbeiten</button>
          <button class="btn btn-sm btn-danger" onclick="deleteIpad(${ip.id})">Löschen</button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('ipad-search').addEventListener('input', () => loadIpads());
document.getElementById('ipad-filter-status').addEventListener('change', () => loadIpads());

document.getElementById('btn-add-ipad').addEventListener('click', () => openIpadModal(null));

// CSV buttons
document.getElementById('btn-ipad-export-csv').addEventListener('click', async () => {
  const res = await window.api.exportIpadsCsv();
  if (res?.success) toast(`${res.count} iPads exportiert: ${res.path}`, 'success');
  else if (res) toast('Export abgebrochen.', 'info');
});

document.getElementById('btn-ipad-import-csv').addEventListener('click', async () => {
  const res = await window.api.importIpadsCsv();
  if (!res || !res.success) { toast('Import abgebrochen.', 'info'); return; }
  let msg = `${res.imported} iPad(s) importiert`;
  if (res.skipped) msg += `, ${res.skipped} übersprungen (Duplikat oder fehlende Pflichtfelder)`;
  toast(msg, res.imported > 0 ? 'success' : 'info');
  if (res.errors?.length) console.warn('CSV Import Fehler:', res.errors);
  loadIpads();
});

document.getElementById('btn-ipad-template').addEventListener('click', async () => {
  await window.api.downloadIpadTemplate();
  toast('Vorlage gespeichert.', 'info');
});

function ipadFormHtml(ipad = null) {
  return `
    <form id="ipad-form">
      <label class="field-label">Nummer / Aufkleber <span class="required">*</span></label>
      <input class="field-input" name="asset_tag" required value="${esc(ipad?.asset_tag ?? '')}" placeholder="z.B. iPad-042" />
      <label class="field-label" style="margin-top:1rem">Modell <span class="required">*</span></label>
      <input class="field-input" name="model" required value="${esc(ipad?.model ?? '')}" placeholder="z.B. iPad 10. Generation (64 GB, Wi-Fi)" />
      <label class="field-label" style="margin-top:1rem">Seriennummer <span class="required">*</span></label>
      <input class="field-input" name="serial" required value="${esc(ipad?.serial ?? '')}" placeholder="z.B. F4GTQ3BWXXYZ" style="font-family:monospace" />
      <label class="field-label" style="margin-top:1rem">Notizen</label>
      <textarea class="field-input" name="notes" rows="2">${esc(ipad?.notes ?? '')}</textarea>
      <div style="margin-top:1.5rem;display:flex;gap:.75rem;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Abbrechen</button>
        <button type="submit" class="btn btn-primary">${ipad ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`;
}

function openIpadModal(ipad) {
  openModal(ipad ? 'iPad bearbeiten' : 'iPad hinzufügen', ipadFormHtml(ipad));
  document.getElementById('ipad-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (ipad) {
      await window.api.updateIpad(ipad.id, data);
      toast('iPad aktualisiert.', 'success');
    } else {
      await window.api.createIpad(data);
      toast('iPad hinzugefügt.', 'success');
    }
    closeModal();
    loadIpads();
  });
}

async function editIpad(id) {
  const ipad = await window.api.getIpad(id);
  openIpadModal(ipad);
}

async function deleteIpad(id) {
  if (!confirm('iPad wirklich löschen?')) return;
  const res = await window.api.deleteIpad(id);
  if (res.success) { toast('iPad gelöscht.', 'success'); loadIpads(); }
  else toast(res.error, 'error');
}

function quickLendIpad(id) {
  switchSection('rentals');
  window._prefillIpadId = id;
}

window.editIpad      = editIpad;
window.deleteIpad    = deleteIpad;
window.quickLendIpad = quickLendIpad;
