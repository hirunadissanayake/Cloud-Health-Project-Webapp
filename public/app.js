const state = {
  activeView: 'dashboard',
  patients: [],
  patient: null,
  appointments: [],
  records: [],
  metrics: [],
  files: [],
  pending: 0
};

const views = ['dashboard', 'patients', 'appointments', 'records', 'metrics', 'files'];
const titles = {
  dashboard: 'Good care starts with clarity.',
  patients: 'Patient registry',
  appointments: 'Coordinated care schedule',
  records: 'Diagnostics and clinical findings',
  metrics: 'Health over time',
  files: 'Secure medical documents'
};

document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  bindForms();
  bindActions();
  updatePatientContext();
  loadPatients();
});

function bindNavigation() {
  document.querySelectorAll('[data-view], [data-go]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view || button.dataset.go));
  });
  document.getElementById('menu-button').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });
  document.getElementById('refresh-button').addEventListener('click', refreshActiveView);
}

function bindActions() {
  document.querySelectorAll('[data-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.classList.contains('require-patient') && !requirePatient()) return;
      document.getElementById(`${button.dataset.toggle}-panel`).classList.toggle('hidden');
    });
  });
  document.getElementById('patient-search-button').addEventListener('click', loadPatients);
  document.getElementById('patient-search').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadPatients();
  });
  document.getElementById('patient-table').addEventListener('click', event => {
    const button = event.target.closest('[data-select-patient]');
    if (button) selectPatient(button.dataset.selectPatient);
  });
  document.getElementById('appointments-list').addEventListener('change', event => {
    if (event.target.matches('[data-appointment-status]')) {
      changeAppointmentStatus(event.target.dataset.appointmentStatus, event.target.value);
    }
  });
  document.getElementById('records-list').addEventListener('click', event => {
    const button = event.target.closest('[data-record-status]');
    if (button) changeRecordStatus(button.dataset.recordStatus, button.dataset.nextStatus);
  });
  document.getElementById('files-list').addEventListener('click', event => {
    const download = event.target.closest('[data-download-file]');
    const remove = event.target.closest('[data-delete-file]');
    if (download) downloadFile(download.dataset.downloadFile);
    if (remove) deleteFile(remove.dataset.deleteFile);
  });
  document.querySelector('#file-form input[type="file"]').addEventListener('change', event => {
    const drop = event.target.closest('.file-drop');
    const file = event.target.files[0];
    drop.classList.toggle('has-file', Boolean(file));
    drop.querySelector('strong').textContent = file ? file.name : 'Choose a medical image or report';
  });
}

function bindForms() {
  document.getElementById('patient-form').addEventListener('submit', submitPatient);
  document.getElementById('appointment-form').addEventListener('submit', submitAppointment);
  document.getElementById('record-form').addEventListener('submit', submitRecord);
  document.getElementById('metric-form').addEventListener('submit', submitMetric);
  document.getElementById('file-form').addEventListener('submit', submitFile);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data.detail || data.message || `Request failed with status ${response.status}`);
    error.problem = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadPatients() {
  const query = document.getElementById('patient-search').value.trim();
  setBusy(true);
  try {
    const result = await api(`/api/patients?size=50${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    state.patients = result.content || [];
    document.getElementById('stat-patients').textContent = result.totalElements ?? state.patients.length;
    renderPatients();
    setConnection(true);
  } catch (error) {
    setConnection(false);
    renderPatients(error.message);
    notify('Could not load patients', error.message, true);
  } finally {
    setBusy(false);
  }
}

async function selectPatient(id) {
  setBusy(true);
  try {
    state.patient = state.patients.find(patient => patient.id === id) || await api(`/api/patients/${id}`);
    updatePatientContext();
    notify('Patient selected', `${state.patient.firstName} ${state.patient.lastName} is now active.`);
    await refreshClinicalData();
    showView('dashboard');
  } catch (error) {
    notify('Could not select patient', error.message, true);
  } finally {
    setBusy(false);
  }
}

async function refreshClinicalData() {
  if (!state.patient) return;
  const patientId = encodeURIComponent(state.patient.id);
  const tasks = [
    api(`/api/patients/${patientId}/appointments?size=50`).then(data => { state.appointments = data.content || []; renderAppointments(); }),
    api(`/api/records?patientId=${patientId}&size=50`).then(data => { state.records = data.content || []; renderRecords(); }),
    api(`/api/diagnostics/health-metrics?patientId=${patientId}&size=50`).then(data => { state.metrics = data.content || []; renderMetrics(); }),
    api(`/api/files?patientId=${patientId}&limit=100`).then(data => { state.files = data || []; renderFiles(); })
  ];
  const results = await Promise.allSettled(tasks);
  const failed = results.filter(result => result.status === 'rejected');
  updateStats();
  if (failed.length) notify('Some clinical data is unavailable', failed[0].reason.message, true);
}

async function refreshActiveView() {
  if (state.activeView === 'patients' || !state.patient) return loadPatients();
  setBusy(true);
  try {
    await refreshClinicalData();
    notify('Workspace refreshed', 'The latest service data is now displayed.');
  } finally {
    setBusy(false);
  }
}

async function submitPatient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    firstName: values.firstName,
    lastName: values.lastName,
    dateOfBirth: values.dateOfBirth,
    gender: values.gender,
    email: nullable(values.email),
    phone: values.phone,
    address: nullable(values.address),
    bloodType: nullable(values.bloodType),
    emergencyContactName: nullable(values.emergencyContactName),
    emergencyContactPhone: nullable(values.emergencyContactPhone),
    medicalHistorySummary: nullable(values.medicalHistorySummary)
  };
  await performMutation('Patient registered', async () => {
    const patient = await api('/api/patients', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    document.getElementById('patient-form-panel').classList.add('hidden');
    await loadPatients();
    await selectPatient(patient.id);
  });
}

async function submitAppointment(event) {
  event.preventDefault();
  if (!requirePatient()) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    scheduledAt: new Date(values.scheduledAt).toISOString(),
    durationMinutes: Number(values.durationMinutes),
    practitionerName: values.practitionerName,
    department: values.department,
    reason: values.reason,
    notes: nullable(values.notes)
  };
  await performMutation('Appointment scheduled', async () => {
    await api(`/api/patients/${state.patient.id}/appointments`, { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    document.getElementById('appointment-form-panel').classList.add('hidden');
    await loadAppointments();
  });
}

async function submitRecord(event) {
  event.preventDefault();
  if (!requirePatient()) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  let diagnosticData;
  try { diagnosticData = JSON.parse(values.diagnosticData); }
  catch { return notify('Invalid diagnostic JSON', 'Correct the JSON syntax before saving.', true); }
  const payload = {
    patientId: state.patient.id,
    appointmentId: null,
    type: values.type,
    title: values.title,
    summary: nullable(values.summary),
    diagnosticData,
    observations: [],
    recordedBy: values.recordedBy,
    recordedAt: new Date().toISOString()
  };
  await performMutation('Diagnostic draft created', async () => {
    await api('/api/records', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    document.getElementById('record-form-panel').classList.add('hidden');
    await loadRecords();
  });
}

async function submitMetric(event) {
  event.preventDefault();
  if (!requirePatient()) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  let measurements;
  try { measurements = JSON.parse(values.measurements); }
  catch { return notify('Invalid measurement JSON', 'Correct the JSON syntax before saving.', true); }
  const payload = { patientId: state.patient.id, type: values.type, measurements, source: values.source, recordedAt: new Date().toISOString() };
  await performMutation('Health metric recorded', async () => {
    await api('/api/diagnostics/health-metrics', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    document.getElementById('metric-form-panel').classList.add('hidden');
    await loadMetrics();
  });
}

async function submitFile(event) {
  event.preventDefault();
  if (!requirePatient()) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = data.get('file');
  if (file instanceof File && file.name.toLowerCase().endsWith('.dcm')
      && !['application/dicom', 'image/dicom'].includes(file.type)) {
    data.set('file', new File([file], file.name, { type: 'application/dicom' }));
  }
  data.set('patientId', state.patient.id);
  await performMutation('Medical file uploaded', async () => {
    await api('/api/files', { method: 'POST', body: data });
    form.reset();
    form.querySelector('.file-drop').classList.remove('has-file');
    form.querySelector('.file-drop strong').textContent = 'Choose a medical image or report';
    document.getElementById('file-form-panel').classList.add('hidden');
    await loadFiles();
  });
}

async function changeAppointmentStatus(id, status) {
  if (!status) return;
  await performMutation(`Appointment marked ${humanize(status).toLowerCase()}`, async () => {
    await api(`/api/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadAppointments();
  });
}

async function changeRecordStatus(id, status) {
  await performMutation(`Record marked ${humanize(status).toLowerCase()}`, async () => {
    await api(`/api/records/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadRecords();
  });
}

async function downloadFile(id) {
  await performMutation('Download prepared', async () => {
    const result = await api(`/api/files/${id}/download-url`, { method: 'POST' });
    const link = document.createElement('a');
    link.href = result.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, 'The signed link opens in a new tab.');
}

async function deleteFile(id) {
  if (!window.confirm('Delete this stored medical file? The metadata remains as an audit record.')) return;
  await performMutation('Medical file deleted', async () => {
    await api(`/api/files/${id}`, { method: 'DELETE' });
    await loadFiles();
  });
}

async function loadAppointments() {
  const data = await api(`/api/patients/${state.patient.id}/appointments?size=50`);
  state.appointments = data.content || []; renderAppointments(); updateStats();
}
async function loadRecords() {
  const data = await api(`/api/records?patientId=${state.patient.id}&size=50`);
  state.records = data.content || []; renderRecords(); updateStats();
}
async function loadMetrics() {
  const data = await api(`/api/diagnostics/health-metrics?patientId=${state.patient.id}&size=50`);
  state.metrics = data.content || []; renderMetrics();
}
async function loadFiles() {
  state.files = await api(`/api/files?patientId=${state.patient.id}&limit=100`); renderFiles(); updateStats();
}

async function performMutation(successTitle, operation, successDetail = 'The clinical workspace is up to date.') {
  setBusy(true);
  try {
    await operation();
    notify(successTitle, successDetail);
  } catch (error) {
    notify('Action could not be completed', fieldErrorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function renderPatients(error) {
  const table = document.getElementById('patient-table');
  const empty = document.getElementById('patient-empty');
  table.innerHTML = state.patients.map(patient => `
    <tr>
      <td><div class="patient-cell"><span class="avatar">${initials(patient)}</span><span><strong>${escapeHtml(patient.firstName)} ${escapeHtml(patient.lastName)}</strong><small>${formatDate(patient.dateOfBirth, false)} · ${humanize(patient.gender)}</small></span></div></td>
      <td><strong>${escapeHtml(patient.medicalRecordNumber)}</strong><div class="muted">Created ${formatDate(patient.createdAt)}</div></td>
      <td>${escapeHtml(patient.email || 'No email')}<div class="muted">${escapeHtml(patient.phone)}</div></td>
      <td><span class="blood-chip">${escapeHtml(patient.bloodType || '—')}</span></td>
      <td><button class="select-button" data-select-patient="${patient.id}">${state.patient?.id === patient.id ? 'Selected' : 'Open chart'} →</button></td>
    </tr>`).join('');
  empty.classList.toggle('hidden', state.patients.length > 0);
  if (error) empty.querySelector('p').textContent = error;
}

function renderAppointments() {
  const container = document.getElementById('appointments-list');
  if (!state.appointments.length) return renderEmpty(container, '□', 'No appointments yet', 'Schedule the first visit for this patient.');
  container.innerHTML = state.appointments.map(item => {
    const transitions = appointmentTransitions(item.status);
    return `<article class="clinical-card"><span class="clinical-icon">□</span><div><h3>${escapeHtml(item.department)} · ${escapeHtml(item.practitionerName)}</h3><p>${escapeHtml(item.reason)}</p><div class="clinical-meta"><span>${formatDate(item.scheduledAt)}</span><span>${item.durationMinutes} minutes</span><span class="status-badge ${item.status.toLowerCase()}">${humanize(item.status)}</span></div></div><div class="card-actions">${transitions.length ? `<select data-appointment-status="${item.id}"><option value="">Change status</option>${transitions.map(status => `<option value="${status}">${humanize(status)}</option>`).join('')}</select>` : ''}</div></article>`;
  }).join('');
}

function renderRecords() {
  const container = document.getElementById('records-list');
  if (!state.records.length) return renderEmpty(container, '◇', 'No diagnostic records', 'Create a draft with structured or dynamic clinical data.');
  container.innerHTML = state.records.map(record => {
    const next = record.status === 'DRAFT' ? 'FINAL' : record.status === 'FINAL' ? 'AMENDED' : 'FINAL';
    return `<article class="clinical-card"><span class="clinical-icon">◇</span><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.summary || summarizeObject(record.diagnosticData))}</p><div class="clinical-meta"><span>${humanize(record.type)}</span><span>${formatDate(record.recordedAt)}</span><span>By ${escapeHtml(record.recordedBy)}</span><span class="status-badge ${record.status.toLowerCase()}">${humanize(record.status)}</span></div></div><div class="card-actions"><button class="secondary-button" data-record-status="${record.id}" data-next-status="${next}">Mark ${humanize(next)}</button></div></article>`;
  }).join('');
}

function renderMetrics() {
  const container = document.getElementById('metrics-list');
  if (!state.metrics.length) return renderEmpty(container, '⌁', 'No health measurements', 'Record vitals or data from a connected source.');
  container.innerHTML = state.metrics.map(metric => {
    const [firstKey, firstValue] = Object.entries(metric.measurements || {})[0] || ['value', '—'];
    const unit = metric.measurements?.unit || '';
    return `<article class="metric-card"><div><h3>${humanize(metric.type)}</h3><span class="status-badge">${escapeHtml(metric.source)}</span></div><div class="metric-value">${escapeHtml(String(firstValue))} <small>${escapeHtml(unit)}</small></div><p>${humanize(firstKey)} · ${formatDate(metric.recordedAt)}</p><div class="metric-data">${escapeHtml(JSON.stringify(metric.measurements, null, 2))}</div></article>`;
  }).join('');
}

function renderFiles() {
  const container = document.getElementById('files-list');
  if (!state.files.length) return renderEmpty(container, '▱', 'No medical files', 'Upload an image or report to the private bucket.');
  container.innerHTML = state.files.map(file => `
    <article class="file-card"><div class="file-top"><span class="file-type">${fileExtension(file.originalFileName)}</span><span class="status-badge">${humanize(file.category)}</span></div><h3>${escapeHtml(file.originalFileName)}</h3><p>${escapeHtml(file.description || 'Secure clinical document')}</p><div class="file-details"><span>${formatBytes(file.sizeBytes)}</span><span>${formatDate(file.uploadedAt)}</span></div><div class="file-actions"><button class="secondary-button" data-download-file="${file.id}">Download</button><button class="danger-button" data-delete-file="${file.id}">Delete</button></div></article>`).join('');
}

function updatePatientContext() {
  const sidebar = document.getElementById('sidebar-patient');
  const dashboard = document.getElementById('dashboard-patient');
  document.querySelectorAll('.require-patient').forEach(button => { button.disabled = !state.patient; });
  if (!state.patient) {
    sidebar.className = 'context-empty'; sidebar.textContent = 'Select a patient to begin';
    dashboard.className = 'empty-state compact';
    dashboard.innerHTML = '<span>♙</span><h4>No patient selected</h4><p>Choose a patient to unlock their clinical workspace.</p>';
    views.filter(view => !['dashboard', 'patients'].includes(view)).forEach(view => renderPatientRequired(view));
    return;
  }
  const patient = state.patient;
  sidebar.className = 'context-patient';
  sidebar.innerHTML = `<span class="avatar">${initials(patient)}</span><span><strong>${escapeHtml(patient.firstName)} ${escapeHtml(patient.lastName)}</strong><small>${escapeHtml(patient.medicalRecordNumber)}</small></span>`;
  dashboard.className = 'patient-summary';
  dashboard.innerHTML = `<span class="avatar">${initials(patient)}</span><div><h4>${escapeHtml(patient.firstName)} ${escapeHtml(patient.lastName)}</h4><p>${escapeHtml(patient.medicalRecordNumber)} · ${formatDate(patient.dateOfBirth, false)} · ${escapeHtml(patient.bloodType || 'Blood type unknown')}</p></div><button class="secondary-button" data-open-chart>Open clinical chart →</button>`;
  dashboard.querySelector('[data-open-chart]').addEventListener('click', () => showView('appointments'));
  document.getElementById('appointments-subtitle').textContent = `Visits for ${patient.firstName} ${patient.lastName}.`;
  document.getElementById('records-subtitle').textContent = `Diagnostic history for ${patient.firstName} ${patient.lastName}.`;
  document.getElementById('metrics-subtitle').textContent = `Longitudinal measurements for ${patient.firstName} ${patient.lastName}.`;
  document.getElementById('files-subtitle').textContent = `Private documents for ${patient.firstName} ${patient.lastName}.`;
}

function updateStats() {
  document.getElementById('stat-appointments').textContent = state.patient ? state.appointments.length : '—';
  document.getElementById('stat-records').textContent = state.patient ? state.records.length : '—';
  document.getElementById('stat-files').textContent = state.patient ? state.files.length : '—';
}

function showView(view) {
  if (!views.includes(view)) return;
  state.activeView = view;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.getElementById('page-title').textContent = titles[view];
  document.querySelector('.sidebar').classList.remove('open');
  window.location.hash = view;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPatientRequired(view) {
  const containers = { appointments: 'appointments-list', records: 'records-list', metrics: 'metrics-list', files: 'files-list' };
  renderEmpty(document.getElementById(containers[view]), '♙', 'Select a patient first', 'Open the patient registry and choose a clinical chart.');
}

function renderEmpty(container, icon, title, message) {
  container.innerHTML = `<div class="panel empty-state"><span>${icon}</span><h4>${escapeHtml(title)}</h4><p>${escapeHtml(message)}</p></div>`;
}

function requirePatient() {
  if (state.patient) return true;
  notify('No active patient', 'Select a patient from the registry before continuing.', true);
  showView('patients');
  return false;
}

function setBusy(busy) {
  state.pending += busy ? 1 : -1;
  state.pending = Math.max(0, state.pending);
  document.getElementById('loading').classList.toggle('hidden', state.pending === 0);
}

function setConnection(connected) {
  const environment = document.querySelector('.environment');
  environment.classList.toggle('connected', connected);
  document.getElementById('connection-state').textContent = connected ? 'Connected' : 'Unavailable';
}

function notify(title, detail, error = false) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  const strong = document.createElement('strong');
  const span = document.createElement('span');
  strong.textContent = title; span.textContent = detail;
  toast.append(strong, span);
  document.getElementById('toast-region').appendChild(toast);
  setTimeout(() => toast.remove(), 4800);
}

function fieldErrorMessage(error) {
  const errors = error.problem?.fieldErrors;
  if (errors && typeof errors === 'object') return Object.entries(errors).map(([field, message]) => `${field}: ${message}`).join(' · ');
  return error.message;
}

function appointmentTransitions(status) {
  if (status === 'SCHEDULED') return ['CONFIRMED', 'CANCELLED'];
  if (status === 'CONFIRMED') return ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
  return [];
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function initials(patient) { return escapeHtml(`${patient.firstName?.[0] || ''}${patient.lastName?.[0] || ''}`.toUpperCase()); }
function humanize(value) { return String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function nullable(value) { return value && value.trim() ? value.trim() : null; }
function summarizeObject(value) { return Object.entries(value || {}).slice(0, 3).map(([key, item]) => `${humanize(key)}: ${typeof item === 'object' ? 'structured data' : item}`).join(' · '); }
function fileExtension(name) { const extension = String(name).split('.').pop(); return escapeHtml(extension && extension !== name ? extension.slice(0, 4).toUpperCase() : 'FILE'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }

if (window.location.hash && views.includes(window.location.hash.slice(1))) showView(window.location.hash.slice(1));
