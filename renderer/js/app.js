'use strict';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    switchSection(link.dataset.section);
  });
});

function switchSection(name) {
  document.querySelectorAll('.nav-item').forEach(l => l.classList.toggle('active', l.dataset.section === name));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
  if (name === 'dashboard') loadDashboard();
  if (name === 'ipads')    loadIpads();
  if (name === 'students') loadStudents();
  if (name === 'rentals')  initRentals();
  if (name === 'history')  loadHistory();
  if (name === 'settings') loadSettings();
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
async function checkSetup() {
  const s = await window.api.getSettings();
  if (s.setup_complete !== '1') {
    document.getElementById('setup-overlay').classList.remove('hidden');
  }
}

document.getElementById('setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  for (const [k, v] of fd.entries()) await window.api.setSetting(k, v);
  await window.api.setSetting('setup_complete', '1');
  document.getElementById('setup-overlay').classList.add('hidden');
  loadDashboard();
});

// ---------------------------------------------------------------------------
// Dashboard (quick-lend button)
// ---------------------------------------------------------------------------
document.getElementById('btn-quick-lend').addEventListener('click', () => switchSection('rentals'));

async function loadDashboard() {
  const stats = await window.api.getDashboardStats();
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = [
    statCard('Gesamt', stats.total, ''),
    statCard('Verfügbar', stats.available, 'success'),
    statCard('Ausgeliehen', stats.rented, 'accent'),
    statCard('Defekt', stats.defect, 'warning'),
    statCard('Verloren', stats.lost, 'danger'),
    statCard('Überfällig', stats.overdue, stats.overdue > 0 ? 'danger' : '',
      stats.overdue > 0 ? 'switchToActiveRentals()' : null),
  ].join('');

  updateOverdueBadge(stats.overdue);

  const act = document.getElementById('recent-activity');
  if (!stats.recentActivity.length) {
    act.innerHTML = '<p style="color:var(--text-muted);padding:.5rem 0">Noch keine Aktivitäten.</p>';
  } else {
    act.innerHTML = stats.recentActivity.map(r => `
      <div class="activity-item">
        <span class="activity-desc">${esc(r.description)}</span>
        <span class="activity-time">${fmtDatetime(r.created_at)}</span>
      </div>`).join('');
  }
}

function statCard(label, value, cls, onclick) {
  const extras = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : '';
  return `<div class="stat-card ${cls}"${extras}><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function updateOverdueBadge(count) {
  const badge = document.getElementById('nav-overdue-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}
window.updateOverdueBadge = updateOverdueBadge;

function switchToActiveRentals() {
  switchSection('rentals');
  document.querySelector('.tab[data-tab="active"]')?.click();
}
window.switchToActiveRentals = switchToActiveRentals;

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------
const modalOverlay = document.getElementById('modal-overlay');
const modalBox     = document.getElementById('modal-box');
const modalTitle   = document.getElementById('modal-title');
const modalBody    = document.getElementById('modal-body');

function openModal(title, bodyHtml, width = '540px') {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalBox.style.maxWidth = width;
  modalOverlay.classList.remove('hidden');
}
function closeModal() { modalOverlay.classList.add('hidden'); }

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// Expose for other modules
window.openModal = openModal;
window.closeModal = closeModal;

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
window.toast = toast;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}.${m}.${y}`;
}
function fmtDatetime(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function statusBadge(status) {
  const map = {
    available: ['Verfügbar','available'],
    rented:    ['Ausgeliehen','rented'],
    defect:    ['Defekt','defect'],
    lost:      ['Verloren','lost'],
    returned:  ['Zurückgegeben','returned'],
  };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="badge badge-${cls}">${label}</span>`;
}
function today() { return new Date().toISOString().slice(0,10); }

// Expose helpers globally
window.esc = esc;
window.fmtDate = fmtDate;
window.fmtDatetime = fmtDatetime;
window.statusBadge = statusBadge;
window.today = today;

// ---------------------------------------------------------------------------
// Autocomplete helper
// ---------------------------------------------------------------------------
function makeAutocomplete({ inputEl, dropdownEl, hiddenEl, infoEl, fetchFn, labelFn, infoFn }) {
  let debounce;
  // Each selection or new keystroke increments this; any in-flight fetch that
  // resolves with a stale generation silently discards its results instead of
  // re-opening the dropdown after the user already made a choice.
  let fetchGen = 0;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounce);
    hiddenEl.value = '';
    if (infoEl) infoEl.classList.add('hidden');
    const q = inputEl.value.trim();
    if (q.length < 1) { dropdownEl.classList.add('hidden'); return; }
    const gen = ++fetchGen;
    debounce = setTimeout(async () => {
      const results = await fetchFn(q);
      if (gen !== fetchGen) return; // superseded by newer input or selection
      if (!results.length) { dropdownEl.classList.add('hidden'); return; }
      dropdownEl.innerHTML = results.map((r, i) =>
        `<div class="autocomplete-item" data-idx="${i}">${esc(labelFn(r))}</div>`
      ).join('');
      dropdownEl._results = results;
      dropdownEl.classList.remove('hidden');
    }, 200);
  });

  dropdownEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    e.preventDefault();
    clearTimeout(debounce);
    fetchGen++; // invalidate any in-flight fetch so it won't reopen the dropdown
    const r = dropdownEl._results[+item.dataset.idx];
    inputEl.value  = labelFn(r);
    hiddenEl.value = r.id;
    dropdownEl.classList.add('hidden');
    if (infoEl && infoFn) { infoEl.innerHTML = infoFn(r); infoEl.classList.remove('hidden'); }
  });

  document.addEventListener('click', e => {
    if (!dropdownEl.contains(e.target) && e.target !== inputEl) dropdownEl.classList.add('hidden');
  });
}
window.makeAutocomplete = makeAutocomplete;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// On macOS with hiddenInset title bar, push sidebar content below the traffic lights.
if (window.api.platform === 'darwin') {
  document.documentElement.style.setProperty('--traffic-offset', '22px');
}

checkSetup().then(() => loadDashboard());
