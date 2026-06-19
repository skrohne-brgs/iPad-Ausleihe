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
    if (tab.dataset.tab === 'active')       loadActiveRentals();
    if (tab.dataset.tab === 'batch')        initBatchTab();
    if (tab.dataset.tab === 'batch-return') initBatchReturnTab();
    if (tab.dataset.tab === 'csv-import')   initCsvImportTab();
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

// ---------------------------------------------------------------------------
// Serienausleihe (Batch)
// ---------------------------------------------------------------------------
let batchReady = false;
let batchPlan  = null;   // zuletzt berechnete Vorschau (pairs etc.)

async function initBatchTab() {
  if (batchReady) { await loadBatchClasses(); return; }
  batchReady = true;

  document.getElementById('batch-date').value = today();
  await loadBatchClasses();

  document.getElementById('batch-preview-btn').addEventListener('click', batchBuildPreview);
  document.getElementById('batch-execute-btn').addEventListener('click', batchRun);
}

async function loadBatchClasses() {
  const classes = await window.api.getClasses();
  const wrap = document.getElementById('batch-class-list');
  if (!classes.length) {
    wrap.innerHTML = '<p style="color:var(--text-muted)">Keine Klassen vorhanden. Bitte zuerst Personen anlegen.</p>';
    return;
  }
  wrap.innerHTML = `
    <div class="batch-class-toolbar" style="grid-column:1/-1">
      <button type="button" id="batch-class-all">Alle w&auml;hlen</button>
      <button type="button" id="batch-class-none">Auswahl aufheben</button>
    </div>` +
    classes.map(c => `
      <label class="batch-class-item">
        <input type="checkbox" class="batch-class-cb" value="${esc(c.class)}" />
        <span>${esc(c.class)}</span>
        <span class="cls-count">${c.available} frei</span>
      </label>`).join('');

  document.getElementById('batch-class-all').addEventListener('click',
    () => document.querySelectorAll('.batch-class-cb').forEach(cb => { cb.checked = true; }));
  document.getElementById('batch-class-none').addEventListener('click',
    () => document.querySelectorAll('.batch-class-cb').forEach(cb => { cb.checked = false; }));
}

function selectedBatchClasses() {
  return Array.from(document.querySelectorAll('.batch-class-cb:checked')).map(cb => cb.value);
}

const AGE_LABEL = { 0: 'fabrikneu', 1: '1 Jahr', 2: '2 Jahre', 3: '3+ Jahre' };

async function batchBuildPreview() {
  const classes = selectedBatchClasses();
  if (!classes.length) { toast('Bitte mindestens eine Klasse wählen.', 'error'); return; }

  batchPlan = await window.api.batchPlan(classes);
  const area = document.getElementById('batch-preview-area');
  const tbody = document.getElementById('batch-preview-tbody');
  const summary = document.getElementById('batch-summary');

  tbody.innerHTML = batchPlan.pairs.map((p, i) => {
    const ry = Math.min(3, Number(p.rental_age_years) || 0);
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(p.last_name)}, ${esc(p.first_name)}</strong></td>
      <td>${esc(p.class)}</td>
      <td>${esc(p.asset_tag)}</td>
      <td>${esc(p.model)}</td>
      <td>${AGE_LABEL[ry]}</td>
    </tr>`;
  }).join('');

  let msg = `<strong>${batchPlan.pairs.length}</strong> Zuordnung(en) &middot; ${batchPlan.personCount} Person(en) ohne Ger&auml;t &middot; ${batchPlan.ipadCount} iPad(s) verf&uuml;gbar.`;
  if (batchPlan.unassignedPersons > 0)
    msg += `<br/><span style="color:var(--danger,#dc2626)">&#9888; ${batchPlan.unassignedPersons} Person(en) bekommen kein Ger&auml;t (zu wenige iPads).</span>`;
  if (batchPlan.unusedIpads > 0)
    msg += `<br/>${batchPlan.unusedIpads} iPad(s) bleiben &uuml;brig.`;
  summary.innerHTML = msg;

  const execBtn = document.getElementById('batch-execute-btn');
  execBtn.disabled = batchPlan.pairs.length === 0;
  area.classList.remove('hidden');
}

async function batchRun() {
  if (!batchPlan || !batchPlan.pairs.length) return;
  const execBtn  = document.getElementById('batch-execute-btn');
  const progress = document.getElementById('batch-progress');
  const total = batchPlan.pairs.length;

  if (!confirm(`${total} iPad(s) verbindlich ausleihen und alle Dokumente erstellen?`)) return;

  execBtn.disabled = true;
  progress.textContent = 'Dokumente werden erstellt… (0/' + total + ')';
  const off = window.api.onBatchProgress(({ done, total }) => {
    progress.textContent = `Dokumente werden erstellt… (${done}/${total})`;
  });

  try {
    const res = await window.api.batchExecute({
      pairs:     batchPlan.pairs,
      lent_date: document.getElementById('batch-date').value,
      due_date:  document.getElementById('batch-due-date').value || null,
    });
    if (res.canceled) { progress.textContent = 'Abgebrochen.'; execBtn.disabled = false; return; }
    if (!res.success) { toast('Fehler: ' + res.error, 'error'); progress.textContent = ''; execBtn.disabled = false; return; }

    progress.textContent = `Fertig: ${res.created} Ausleihe(n) gespeichert.`;
    toast(`${res.created} iPad(s) ausgeliehen. Dokumente liegen im Ordner.`, 'success');
    if (res.errors && res.errors.length) {
      toast(`${res.errors.length} Fehler – siehe Details.`, 'error');
      console.error('Serienausleihe-Fehler:', res.errors);
    }
    // Vorschau zuruecksetzen, Klassenanzahl aktualisieren
    batchPlan = null;
    document.getElementById('batch-preview-area').classList.add('hidden');
    await loadBatchClasses();
    populateAvailableIpads();
  } finally {
    off();
  }
}

window.initBatchTab = initBatchTab;

// ---------------------------------------------------------------------------
// Serienrückgabe (Batch Return)
// ---------------------------------------------------------------------------
let batchReturnReady = false;

async function initBatchReturnTab() {
  if (batchReturnReady) { await loadBatchReturnRentals(); return; }
  batchReturnReady = true;

  document.getElementById('batch-return-date').value = today();
  await loadBatchReturnRentals();

  document.getElementById('batch-return-search').addEventListener('input', loadBatchReturnRentals);
  document.getElementById('batch-return-all').addEventListener('click', () =>
    document.querySelectorAll('.batch-return-cb').forEach(cb => { cb.checked = true; })
  );
  document.getElementById('batch-return-none').addEventListener('click', () =>
    document.querySelectorAll('.batch-return-cb').forEach(cb => { cb.checked = false; })
  );
  document.getElementById('batch-return-check-all').addEventListener('change', e =>
    document.querySelectorAll('.batch-return-cb').forEach(cb => { cb.checked = e.target.checked; })
  );
  document.getElementById('batch-return-execute-btn').addEventListener('click', batchReturnRun);
}

async function loadBatchReturnRentals() {
  const search = document.getElementById('batch-return-search').value.trim();
  const rentals = await window.api.getRentals({ status: 'active', search: search || undefined });
  const tbody = document.getElementById('batch-return-tbody');
  document.getElementById('batch-return-check-all').checked = false;
  if (!rentals.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Keine aktiven Ausleihen.</td></tr>';
    return;
  }
  tbody.innerHTML = rentals.map(r => {
    const overdue = r.due_date && r.due_date < today();
    return `<tr>
      <td><input type="checkbox" class="batch-return-cb" value="${r.id}" /></td>
      <td><strong>${esc(r.last_name)}, ${esc(r.first_name)}</strong></td>
      <td>${esc(r.class)}</td>
      <td>${esc(r.asset_tag)}</td>
      <td>${fmtDate(r.lent_date)}</td>
      <td>${r.due_date ? `<span class="${overdue ? 'badge badge-overdue' : ''}">${fmtDate(r.due_date)}</span>` : '—'}</td>
    </tr>`;
  }).join('');
}

async function batchReturnRun() {
  const ids = Array.from(document.querySelectorAll('.batch-return-cb:checked')).map(cb => +cb.value);
  if (!ids.length) { toast('Bitte mindestens eine Ausleihe auswählen.', 'error'); return; }
  const returnDate = document.getElementById('batch-return-date').value;
  const condition  = document.getElementById('batch-return-condition').value;
  if (!returnDate) { toast('Bitte Rückgabedatum angeben.', 'error'); return; }
  if (!confirm(`${ids.length} iPad(s) zurückgeben und Rückgabebescheinigungen erstellen?`)) return;

  const execBtn  = document.getElementById('batch-return-execute-btn');
  const progress = document.getElementById('batch-return-progress');
  execBtn.disabled = true;
  progress.textContent = `Verarbeite… (0/${ids.length})`;

  const off = window.api.onBatchReturnProgress(({ done, total }) => {
    progress.textContent = `Verarbeite… (${done}/${total})`;
  });

  try {
    const res = await window.api.batchReturn({ rentalIds: ids, return_date: returnDate, condition });
    if (res.canceled) { progress.textContent = 'Abgebrochen.'; return; }
    if (!res.success) { toast('Fehler: ' + res.error, 'error'); progress.textContent = ''; return; }

    progress.textContent = `Fertig: ${res.created} Rückgabe(n) gespeichert.`;
    toast(`${res.created} iPad(s) zurückgegeben. Dokumente liegen im Ordner.`, 'success');
    if (res.errors && res.errors.length) {
      toast(`${res.errors.length} Fehler – Details in der Konsole.`, 'error');
      console.error('Serienrückgabe-Fehler:', res.errors);
    }
    await loadBatchReturnRentals();
    populateAvailableIpads();
  } finally {
    off();
    execBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// CSV-Import Zuweisungsliste
// ---------------------------------------------------------------------------
let csvImportReady = false;

function initCsvImportTab() {
  if (csvImportReady) return;
  csvImportReady = true;

  document.getElementById('csv-import-date').value = today();

  document.getElementById('csv-import-pick-dir').addEventListener('click', async () => {
    const dir = await window.api.selectDir();
    if (dir) document.getElementById('csv-import-target-dir').value = dir;
  });

  document.getElementById('csv-import-btn').addEventListener('click', async () => {
    const lent_date  = document.getElementById('csv-import-date').value;
    const due_date   = document.getElementById('csv-import-due-date').value || null;
    const target_dir = document.getElementById('csv-import-target-dir').value.trim();
    if (!lent_date)  { toast('Bitte Standard-Ausleihdatum angeben.', 'error'); return; }
    if (!target_dir) { toast('Bitte zuerst einen Zielordner wählen.', 'error'); return; }

    const btn      = document.getElementById('csv-import-btn');
    const progress = document.getElementById('csv-import-progress');
    const resultEl = document.getElementById('csv-import-result');
    btn.disabled = true;
    progress.textContent = 'Importiere…';
    resultEl.classList.add('hidden');

    const off = window.api.onCsvImportProgress(({ done, total }) => {
      progress.textContent = `${done} / ${total}…`;
    });

    let res;
    try {
      res = await window.api.importRentalsCsv({ lent_date, due_date, target_dir });
    } catch (e) {
      toast('Import fehlgeschlagen: ' + e.message, 'error');
      progress.textContent = '';
      btn.disabled = false;
      off();
      return;
    }
    off();
    btn.disabled = false;
    progress.textContent = '';

    if (!res || res.canceled) return;
    if (!res.success && res.imported === undefined) { toast(res.error || 'Import fehlgeschlagen.', 'error'); return; }

    let html = `<div class="info-box"><strong>${res.imported} Ausleihe(n) erfolgreich importiert</strong>`;
    if (res.skipped) html += ` &middot; ${res.skipped} &uuml;bersprungen`;
    if (res.folder)  html += `<br><small>Leihvertr&auml;ge gespeichert in: ${esc(res.folder)}</small>`;
    html += '</div>';
    if (res.errors && res.errors.length) {
      html += `<div style="margin-top:.5rem;color:var(--danger,#dc2626);font-size:.9rem">` +
        res.errors.slice(0, 20).map(e => `<div>&#9888; ${esc(e)}</div>`).join('') + '</div>';
      if (res.errors.length > 20) html += `<div style="color:var(--danger,#dc2626);font-size:.85rem">… und ${res.errors.length - 20} weitere Fehler.</div>`;
    }
    resultEl.innerHTML = html;
    resultEl.classList.remove('hidden');
    toast(`${res.imported} Ausleihe(n) importiert.`, res.imported > 0 ? 'success' : 'info');
    populateAvailableIpads();
  });
}
