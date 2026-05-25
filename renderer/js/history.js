'use strict';

async function loadHistory(filter = {}) {
  const log = await window.api.getAuditLog(filter);
  const tbody = document.getElementById('history-tbody');
  if (!log.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">Keine Einträge gefunden.</td></tr>';
    return;
  }
  const eventLabels = {
    LEND: 'Ausleihe', RETURN: 'Rückgabe', REPORT: 'Meldung',
    CREATE: 'Erstellt', UPDATE: 'Aktualisiert', DELETE: 'Gelöscht',
  };
  tbody.innerHTML = log.map(r => `
    <tr>
      <td style="white-space:nowrap">${fmtDatetime(r.created_at)}</td>
      <td><span class="badge badge-${badgeCls(r.event_type)}">${eventLabels[r.event_type] ?? r.event_type}</span></td>
      <td>${esc(r.description)}</td>
    </tr>`).join('');
}

function badgeCls(t) {
  return { LEND:'rented', RETURN:'available', REPORT:'defect', CREATE:'available', UPDATE:'rented', DELETE:'lost' }[t] || '';
}

document.getElementById('btn-history-filter').addEventListener('click', () => {
  loadHistory({
    event_type: document.getElementById('history-filter-type').value || undefined,
    from_date:  document.getElementById('history-from').value || undefined,
    to_date:    document.getElementById('history-to').value || undefined,
  });
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const res = await window.api.exportData();
  if (res?.success) toast(`Backup gespeichert: ${res.path}`, 'success');
  else if (res) toast('Export abgebrochen.', 'info');
});

document.getElementById('btn-import').addEventListener('click', async () => {
  await window.api.importData();
});
