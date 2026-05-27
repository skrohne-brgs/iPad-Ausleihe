'use strict';

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
document.querySelectorAll('.tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'active') loadActiveRentals();
  });
});

let rentalsReady = false;

function initRentals() {
  if (rentalsReady) { loadActiveRentals(); return; }
  rentalsReady = true;

  // Today defaults
  document.getElementById('lend-date').value     = today();
  document.getElementById('incident-date').value = today();
  document.getElementById('return-date').value   = today();

  // --- LEND: student autocomplete ---
  makeAutocomplete({
    inputEl:    document.getElementById('lend-student-input'),
    dropdownEl: document.getElementById('lend-student-dropdown'),
    hiddenEl:   document.getElementById('lend-student-id'),
    infoEl:     null,
    fetchFn:    q => window.api.searchStudents(q),
    labelFn:    s => `${s.last_name}, ${s.first_name} — ${s.class}`,
  });

  // --- LEND: iPad select population ---
  populateAvailableIpads();
  document.getElementById('lend-ipad-select').addEventListener('change', e => {
    const info = document.getElementById('lend-ipad-info');
    const opt  = e.target.selectedOptions[0];
    if (opt && opt.value) {
      info.innerHTML = `<strong>Modell:</strong> ${esc(opt.dataset.model)}<br/><strong>Seriennr.:</strong> <code>${esc(opt.dataset.serial)}</code>`;
      info.classList.remove('hidden');
    } else { info.classList.add('hidden'); }
  });

  // --- LEND: QR/barcode scanner input ---
  document.getElementById('lend-qr-scan').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tag = e.target.value.trim();
    if (!tag) return;
    const sel    = document.getElementById('lend-ipad-select');
    const option = Array.from(sel.options).find(o => o.dataset.tag === tag);
    if (option && option.value) {
      sel.value = option.value;
      sel.dispatchEvent(new Event('change'));
      e.target.value = '';
      toast(`iPad ${esc(tag)} ausgewählt.`, 'success');
    } else {
      toast(`iPad „${esc(tag)}“ nicht verfügbar oder nicht gefunden.`, 'error');
      e.target.value = '';
    }
  });

  // --- LEND: form submit ---
  document.getElementById('lend-form').addEventListener('submit', async e => {
    e.preventDefault();
    const studentId = +document.getElementById('lend-student-id').value;
    const ipadId    = +document.getElementById('lend-ipad-select').value;
    if (!studentId) { toast('Bitte Person auswählen.', 'error'); return; }
    if (!ipadId)    { toast('Bitte iPad auswählen.', 'error'); return; }
    const data = {
      student_id:        studentId,
      ipad_id:           ipadId,
      lent_date:         document.getElementById('lend-date').value,
      due_date:          document.getElementById('lend-due-date').value || null,
      condition_at_lend: document.getElementById('lend-condition').value,
      accessories:       document.getElementById('lend-accessories').value.trim(),
      notes:             document.getElementById('lend-notes').value,
    };
    const rentalId = await window.api.createRental(data);
    toast('Ausleihe gespeichert. PDFs werden erstellt…', 'info');
    const pdf1 = await window.api.generateMietvertrag(rentalId);
    if (pdf1.success) toast('Leihvertrag erstellt und geöffnet.', 'success');
    else toast('Fehler beim Leihvertrag: ' + pdf1.error, 'error');
    const pdf2 = await window.api.generateEmpfangsbestaetigung(rentalId);
    if (pdf2.success) toast('Empfangsbestätigung erstellt.', 'success');
    else toast('Fehler bei Empfangsbestätigung: ' + pdf2.error, 'error');
    resetLendForm();
    populateAvailableIpads();
  });

  // --- RETURN: rental autocomplete ---
  makeAutocomplete({
    inputEl:    document.getElementById('return-rental-input'),
    dropdownEl: document.getElementById('return-rental-dropdown'),
    hiddenEl:   document.getElementById('return-rental-id'),
    infoEl:     document.getElementById('return-rental-info'),
    fetchFn:    async q => window.api.getRentals({ status: 'active', search: q }),
    labelFn:    r => `${r.last_name}, ${r.first_name} (${r.class}) — ${r.asset_tag}`,
    infoFn:     r => `<strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong> &middot; ${esc(r.class)}<br/>iPad: <strong>${esc(r.asset_tag)}</strong> (${esc(r.model)})<br/>Ausgeliehen am: ${fmtDate(r.lent_date)}`,
  });

  document.getElementById('return-condition').addEventListener('change', e => {
    const wrap = document.getElementById('return-condition-notes-wrap');
    wrap.classList.toggle('hidden', !['stark_beschaedigt','defekt','verloren'].includes(e.target.value));
  });

  // --- RETURN: form submit ---
  document.getElementById('return-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rentalId = +document.getElementById('return-rental-id').value;
    if (!rentalId) { toast('Bitte eine aktive Ausleihe auswählen.', 'error'); return; }
    const condition = document.getElementById('return-condition').value;
    const data = {
      return_date:     document.getElementById('return-date').value,
      condition,
      condition_notes: document.getElementById('return-condition-notes').value,
    };
    const result = await window.api.returnRental(rentalId, data);
    toast('Rückgabe gespeichert. PDF wird erstellt…', 'info');
    const pdf = await window.api.generateRueckgabe(result.returnId);
    if (pdf.success) toast('Rückgabebescheinigung erstellt.', 'success');
    else toast('Fehler beim PDF: ' + pdf.error, 'error');

    if (['defekt','verloren'].includes(condition)) {
      const incidentData = {
        rental_id:     rentalId,
        report_date:   data.return_date,
        incident_type: condition === 'verloren' ? 'verlust' : 'defekt',
        description:   data.condition_notes || condition,
        repair_cost:   null,
        damage_types:  '[]',
        police_reference: '',
      };
      const incidentId = await window.api.createIncident(incidentData);
      const pdf2 = await window.api.generateVerlustanzeige(incidentId);
      if (pdf2.success) toast('Verlust-/Defektanzeige ebenfalls erstellt.', 'success');
    }
    resetReturnForm();
    populateAvailableIpads();
  });

  // --- INCIDENT: show/hide police reference based on type ---
  document.getElementById('incident-type').addEventListener('change', e => {
    const policeWrap = document.getElementById('incident-police-wrap');
    policeWrap.classList.toggle('hidden', e.target.value !== 'verlust');
  });

  // --- INCIDENT: rental autocomplete ---
  makeAutocomplete({
    inputEl:    document.getElementById('incident-rental-input'),
    dropdownEl: document.getElementById('incident-rental-dropdown'),
    hiddenEl:   document.getElementById('incident-rental-id'),
    infoEl:     document.getElementById('incident-rental-info'),
    fetchFn:    async q => window.api.getRentals({ status: 'active', search: q }),
    labelFn:    r => `${r.last_name}, ${r.first_name} (${r.class}) — ${r.asset_tag}`,
    infoFn:     r => `<strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong> &middot; ${esc(r.class)}<br/>iPad: <strong>${esc(r.asset_tag)}</strong> (${esc(r.model)})<br/>Ausgeliehen am: ${fmtDate(r.lent_date)}`,
  });

  // --- INCIDENT: form submit ---
  document.getElementById('incident-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rentalId = +document.getElementById('incident-rental-id').value;
    if (!rentalId) { toast('Bitte eine aktive Ausleihe auswählen.', 'error'); return; }
    const incidentType = document.getElementById('incident-type').value;
    // Collect checked damage types
    const checkedTypes = Array.from(
      document.querySelectorAll('#incident-damage-types input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    const data = {
      rental_id:       rentalId,
      report_date:     document.getElementById('incident-date').value,
      incident_type:   incidentType,
      description:     document.getElementById('incident-description').value,
      repair_cost:     parseFloat(document.getElementById('incident-cost').value) || null,
      damage_types:    JSON.stringify(checkedTypes),
      police_reference: incidentType === 'verlust'
        ? (document.getElementById('incident-police-reference').value.trim() || '')
        : '',
    };
    if (!data.description.trim()) { toast('Bitte Beschreibung eingeben.', 'error'); return; }
    const incidentId = await window.api.createIncident(data);
    toast('Meldung gespeichert. PDF wird erstellt…', 'info');
    const pdf = await window.api.generateVerlustanzeige(incidentId);
    if (pdf.success) toast('Verlust-/Defektanzeige erstellt.', 'success');
    else toast('Fehler beim PDF: ' + pdf.error, 'error');
    resetIncidentForm();
  });

  loadActiveRentals();
}

async function populateAvailableIpads() {
  const ipads = await window.api.getIpads({ status: 'available' });
  const sel   = document.getElementById('lend-ipad-select');
  sel.innerHTML = '<option value="">-- iPad auswählen --</option>' +
    ipads.map(ip =>
      `<option value="${ip.id}" data-tag="${esc(ip.asset_tag)}" data-model="${esc(ip.model)}" data-serial="${esc(ip.serial)}">${esc(ip.asset_tag)} — ${esc(ip.model)}</option>`
    ).join('');
  if (window._prefillIpadId) {
    sel.value = String(window._prefillIpadId);
    sel.dispatchEvent(new Event('change'));
    window._prefillIpadId = null;
  }
}

async function loadActiveRentals() {
  const filter = {
    status: 'active',
    search: document.getElementById('active-search').value.trim() || undefined,
  };
  const rentals = await window.api.getRentals(filter);
  const tbody   = document.getElementById('active-rentals-tbody');
  if (!rentals.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Keine aktiven Ausleihen.</td></tr>';
    return;
  }
  tbody.innerHTML = rentals.map(r => {
    const overdue = r.due_date && r.due_date < today();
    return `<tr>
      <td><strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong></td>
      <td>${esc(r.class)}</td>
      <td>${esc(r.asset_tag)}</td>
      <td>${fmtDate(r.lent_date)}</td>
      <td>${r.due_date ? `<span class="${overdue ? 'badge badge-overdue' : ''}">${fmtDate(r.due_date)}</span>` : '—'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="prefillReturn(${r.id},'${esc(r.last_name)}, ${esc(r.first_name)} — ${esc(r.asset_tag)}')">Rückgabe</button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('active-search').addEventListener('input', () => loadActiveRentals());

function prefillReturn(rentalId, label) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab[data-tab="return"]').classList.add('active');
  document.getElementById('tab-return').classList.add('active');
  document.getElementById('return-rental-input').value = label;
  document.getElementById('return-rental-id').value    = rentalId;
  const info = document.getElementById('return-rental-info');
  info.innerHTML = `Ausgewählte Ausleihe: <strong>${esc(label)}</strong>`;
  info.classList.remove('hidden');
}

function resetLendForm() {
  document.getElementById('lend-form').reset();
  document.getElementById('lend-date').value       = today();
  document.getElementById('lend-student-id').value = '';
  document.getElementById('lend-ipad-info').classList.add('hidden');
  document.getElementById('lend-accessories').value = '';
}

function resetReturnForm() {
  document.getElementById('return-form').reset();
  document.getElementById('return-date').value        = today();
  document.getElementById('return-rental-id').value   = '';
  document.getElementById('return-rental-info').classList.add('hidden');
  document.getElementById('return-condition-notes-wrap').classList.add('hidden');
}

function resetIncidentForm() {
  document.getElementById('incident-form').reset();
  document.getElementById('incident-date').value = today();
  document.getElementById('incident-rental-id').value = '';
  document.getElementById('incident-rental-info').classList.add('hidden');
  document.getElementById('incident-police-wrap').classList.add('hidden');
  document.querySelectorAll('#incident-damage-types input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

window.prefillReturn = prefillReturn;
