'use strict';

async function loadStudents() {
  const filter = {
    search: document.getElementById('student-search').value.trim() || undefined,
  };
  const students = await window.api.getStudents(filter);
  const tbody = document.getElementById('students-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Keine Schüler gefunden.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(s => `
    <tr>
      <td><strong>${esc(s.last_name)}, ${esc(s.first_name)}</strong></td>
      <td>${esc(s.class)}</td>
      <td style="font-family:monospace;font-size:.85rem">${esc(s.moin_username) || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${s.guardian_email ? esc(s.guardian_email) : (s.guardian_phone ? esc(s.guardian_phone) : '<span style="color:var(--text-muted)">—</span>')}</td>
      <td>${s.active_rentals > 0 ? `<span class="badge badge-rented">${s.active_rentals} aktiv</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-sm btn-secondary" onclick="editStudent(${s.id})">Bearbeiten</button>
          <button class="btn btn-sm btn-danger" onclick="deleteStudent(${s.id})">Löschen</button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('student-search').addEventListener('input', () => loadStudents());
document.getElementById('btn-add-student').addEventListener('click', () => openStudentModal(null));

function studentFormHtml(s = null) {
  return `
    <form id="student-form">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div>
          <label class="field-label">Vorname <span class="required">*</span></label>
          <input class="field-input" name="first_name" required value="${esc(s?.first_name ?? '')}" />
        </div>
        <div>
          <label class="field-label">Nachname <span class="required">*</span></label>
          <input class="field-input" name="last_name" required value="${esc(s?.last_name ?? '')}" />
        </div>
      </div>
      <label class="field-label" style="margin-top:1rem">Klasse <span class="required">*</span></label>
      <input class="field-input" name="class" required value="${esc(s?.class ?? '')}" placeholder="z.B. 9b" />
      <label class="field-label" style="margin-top:1rem">Moin.Schule-Benutzername</label>
      <input class="field-input" name="moin_username" value="${esc(s?.moin_username ?? '')}" placeholder="z.B. max.mustermann" />
      <label class="field-label" style="margin-top:1rem">E-Mail (Erziehungsberechtigte)</label>
      <input class="field-input" name="guardian_email" type="email" value="${esc(s?.guardian_email ?? '')}" />
      <label class="field-label" style="margin-top:1rem">Telefon (Erziehungsberechtigte)</label>
      <input class="field-input" name="guardian_phone" value="${esc(s?.guardian_phone ?? '')}" />
      <label class="field-label" style="margin-top:1rem">Notizen</label>
      <textarea class="field-input" name="notes" rows="2">${esc(s?.notes ?? '')}</textarea>
      <div style="margin-top:1.5rem;display:flex;gap:.75rem;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Abbrechen</button>
        <button type="submit" class="btn btn-primary">${s ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`;
}

function openStudentModal(s) {
  openModal(s ? 'Schüler bearbeiten' : 'Schüler hinzufügen', studentFormHtml(s), '600px');
  document.getElementById('student-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (s) { await window.api.updateStudent(s.id, data); toast('Schüler aktualisiert.', 'success'); }
    else   { await window.api.createStudent(data);       toast('Schüler hinzugefügt.', 'success'); }
    closeModal();
    loadStudents();
  });
}

async function editStudent(id) {
  const s = await window.api.getStudent(id);
  openStudentModal(s);
}

async function deleteStudent(id) {
  if (!confirm('Schüler wirklich löschen?')) return;
  const res = await window.api.deleteStudent(id);
  if (res.success) { toast('Schüler gelöscht.', 'success'); loadStudents(); }
  else toast(res.error, 'error');
}

window.editStudent   = editStudent;
window.deleteStudent = deleteStudent;
