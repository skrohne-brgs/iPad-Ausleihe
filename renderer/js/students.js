'use strict';

async function loadStudents() {
  const filter = {
    search:        document.getElementById('student-search').value.trim() || undefined,
    borrower_type: document.getElementById('student-filter-type').value || undefined,
  };
  const students = await window.api.getStudents(filter);
  const tbody = document.getElementById('students-tbody');
  if (!students.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Keine Einträge gefunden.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(s => {
    const isTeacher = s.borrower_type === 'lehrer';
    const typBadge = isTeacher
      ? '<span class="badge badge-rented">Lehrkraft</span>'
      : '<span class="badge badge-available">Schüler/in</span>';
    const contact = s.guardian_email || s.guardian_phone
      ? esc(s.guardian_email || s.guardian_phone)
      : '<span style="color:var(--text-muted)">&mdash;</span>';
    return `
    <tr>
      <td><strong>${esc(s.last_name)}, ${esc(s.first_name)}</strong></td>
      <td>${esc(s.class)}</td>
      <td style="font-family:monospace;font-size:.85rem">${esc(s.moin_username) || '<span style="color:var(--text-muted)">&mdash;</span>'}</td>
      <td>${isTeacher ? '<span style="color:var(--text-muted)">&mdash;</span>' : contact}</td>
      <td>${typBadge}</td>
      <td>${s.active_rentals > 0 ? `<span class="badge badge-rented">${s.active_rentals} aktiv</span>` : '<span style="color:var(--text-muted)">&mdash;</span>'}</td>
      <td>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-sm btn-secondary" onclick="editStudent(${s.id})">Bearbeiten</button>
          <button class="btn btn-sm btn-danger" onclick="deleteStudent(${s.id})">Löschen</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('student-search').addEventListener('input', () => loadStudents());
document.getElementById('student-filter-type').addEventListener('change', () => loadStudents());
document.getElementById('btn-add-student').addEventListener('click', () => openStudentModal(null));

// CSV buttons
document.getElementById('btn-student-export-csv').addEventListener('click', async () => {
  const res = await window.api.exportStudentsCsv();
  if (res?.success) toast(`${res.count} Einträge exportiert: ${res.path}`, 'success');
  else if (res) toast('Export abgebrochen.', 'info');
});

document.getElementById('btn-student-import-csv').addEventListener('click', async () => {
  const res = await window.api.importStudentsCsv();
  if (!res || !res.success) { toast('Import abgebrochen.', 'info'); return; }
  let msg = `${res.imported} Einträge importiert`;
  if (res.skipped) msg += `, ${res.skipped} übersprungen (Duplikat oder fehlende Pflichtfelder)`;
  toast(msg, res.imported > 0 ? 'success' : 'info');
  if (res.errors?.length) console.warn('CSV Import Fehler:', res.errors);
  loadStudents();
});

document.getElementById('btn-student-template').addEventListener('click', async () => {
  await window.api.downloadStudentTemplate();
  toast('Vorlage gespeichert.', 'info');
});

function studentFormHtml(s = null) {
  const isTeacher = s?.borrower_type === 'lehrer';
  return `
    <form id="student-form">
      <label class="field-label">Typ <span class="required">*</span></label>
      <select class="field-input" name="borrower_type" id="sf-borrower-type">
        <option value="schueler"${!isTeacher ? ' selected' : ''}>Schüler/in</option>
        <option value="lehrer"${isTeacher ? ' selected' : ''}>Lehrkraft</option>
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:1rem">
        <div>
          <label class="field-label">Vorname <span class="required">*</span></label>
          <input class="field-input" name="first_name" required value="${esc(s?.first_name ?? '')}" />
        </div>
        <div>
          <label class="field-label">Nachname <span class="required">*</span></label>
          <input class="field-input" name="last_name" required value="${esc(s?.last_name ?? '')}" />
        </div>
      </div>
      <div id="sf-class-row"${isTeacher ? ' style="display:none"' : ''}>
        <label class="field-label" style="margin-top:1rem">Klasse <span class="required">*</span></label>
        <input class="field-input" name="class" id="sf-class-input" ${!isTeacher ? 'required' : ''}
          value="${esc(isTeacher ? (s?.class || 'Lehrkraft') : (s?.class ?? ''))}"
          placeholder="z.B. 9b" />
      </div>
      <label class="field-label" style="margin-top:1rem">Moin.Schule-Benutzername</label>
      <input class="field-input" name="moin_username" value="${esc(s?.moin_username ?? '')}" placeholder="z.B. max.mustermann" />
      <p style="font-size:.85rem;font-weight:600;color:var(--text-muted);margin-top:1.25rem;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.04em">Adresse</p>
      <label class="field-label">Stra&szlig;e und Hausnummer</label>
      <input class="field-input" name="street" value="${esc(s?.street ?? '')}" placeholder="z.B. Musterstraße 12" />
      <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem;margin-top:1rem">
        <div>
          <label class="field-label">PLZ</label>
          <input class="field-input" name="plz" value="${esc(s?.plz ?? '')}" placeholder="27432" />
        </div>
        <div>
          <label class="field-label">Ort</label>
          <input class="field-input" name="city" value="${esc(s?.city ?? '')}" placeholder="z.B. Bremervörde" />
        </div>
      </div>
      <div id="sf-guardian-fields"${isTeacher ? ' style="display:none"' : ''}>
        <p style="font-size:.85rem;font-weight:600;color:var(--text-muted);margin-top:1.25rem;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.04em">Erziehungsberechtigte/r</p>
        <label class="field-label">Name der Erziehungsberechtigten</label>
        <input class="field-input" name="guardian_name" value="${esc(s?.guardian_name ?? '')}" placeholder="z.B. Maria Mustermann" />
        <label class="field-label" style="margin-top:1rem">Stra&szlig;e und Hausnummer</label>
        <input class="field-input" name="guardian_street" value="${esc(s?.guardian_street ?? '')}" placeholder="z.B. Musterstraße 12" />
        <div style="display:grid;grid-template-columns:120px 1fr;gap:.75rem;margin-top:1rem">
          <div>
            <label class="field-label">PLZ</label>
            <input class="field-input" name="guardian_plz" value="${esc(s?.guardian_plz ?? '')}" placeholder="27432" />
          </div>
          <div>
            <label class="field-label">Ort</label>
            <input class="field-input" name="guardian_city" value="${esc(s?.guardian_city ?? '')}" placeholder="Bremervörde" />
          </div>
        </div>
        <label class="field-label" style="margin-top:1rem">E-Mail (Erziehungsberechtigte)</label>
        <input class="field-input" name="guardian_email" type="email" value="${esc(s?.guardian_email ?? '')}" />
        <label class="field-label" style="margin-top:1rem">Telefon (Erziehungsberechtigte)</label>
        <input class="field-input" name="guardian_phone" value="${esc(s?.guardian_phone ?? '')}" />
      </div>
      <label class="field-label" style="margin-top:1rem">Notizen</label>
      <textarea class="field-input" name="notes" rows="2">${esc(s?.notes ?? '')}</textarea>
      <div style="margin-top:1.5rem;display:flex;gap:.75rem;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" onclick="window.closeModal()">Abbrechen</button>
        <button type="submit" class="btn btn-primary">${s ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`;
}

function wireStudentTypeToggle() {
  const typeSelect = document.getElementById('sf-borrower-type');
  if (!typeSelect) return;
  typeSelect.addEventListener('change', () => {
    const teacher = typeSelect.value === 'lehrer';
    const guardianFields = document.getElementById('sf-guardian-fields');
    const classRow  = document.getElementById('sf-class-row');
    const classInput = document.getElementById('sf-class-input');
    if (guardianFields) guardianFields.style.display = teacher ? 'none' : '';
    if (classRow) classRow.style.display = teacher ? 'none' : '';
    if (classInput) {
      if (teacher) {
        classInput.value = 'Lehrkraft';
        classInput.removeAttribute('required');
      } else {
        classInput.value = '';
        classInput.setAttribute('required', '');
        classInput.placeholder = 'z.B. 9b';
      }
    }
  });
}

function openStudentModal(s) {
  openModal(s ? 'Person bearbeiten' : 'Person hinzufügen', studentFormHtml(s), '640px');
  wireStudentTypeToggle();
  document.getElementById('student-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (s) { await window.api.updateStudent(s.id, data); toast('Gespeichert.', 'success'); }
    else   { await window.api.createStudent(data);       toast('Hinzugefügt.', 'success'); }
    closeModal();
    loadStudents();
  });
}

async function editStudent(id) {
  const s = await window.api.getStudent(id);
  openStudentModal(s);
}

async function deleteStudent(id) {
  if (!confirm('Eintrag wirklich löschen?')) return;
  const res = await window.api.deleteStudent(id);
  if (res.success) { toast('Gelöscht.', 'success'); loadStudents(); }
  else toast(res.error, 'error');
}

window.editStudent   = editStudent;
window.deleteStudent = deleteStudent;
