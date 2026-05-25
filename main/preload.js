'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSettings:        ()           => ipcRenderer.invoke('settings:get'),
  setSetting:         (key, value) => ipcRenderer.invoke('settings:set', key, value),
  selectLogo:         ()           => ipcRenderer.invoke('settings:selectLogo'),

  // iPads
  getIpads:           (filter)     => ipcRenderer.invoke('ipads:getAll', filter),
  getIpad:            (id)         => ipcRenderer.invoke('ipads:getById', id),
  createIpad:         (data)       => ipcRenderer.invoke('ipads:create', data),
  updateIpad:         (id, data)   => ipcRenderer.invoke('ipads:update', id, data),
  deleteIpad:         (id)         => ipcRenderer.invoke('ipads:delete', id),

  // Students
  getStudents:        (filter)     => ipcRenderer.invoke('students:getAll', filter),
  getStudent:         (id)         => ipcRenderer.invoke('students:getById', id),
  createStudent:      (data)       => ipcRenderer.invoke('students:create', data),
  updateStudent:      (id, data)   => ipcRenderer.invoke('students:update', id, data),
  deleteStudent:      (id)         => ipcRenderer.invoke('students:delete', id),
  searchStudents:     (query)      => ipcRenderer.invoke('students:search', query),

  // Rentals
  getRentals:         (filter)     => ipcRenderer.invoke('rentals:getAll', filter),
  getRental:          (id)         => ipcRenderer.invoke('rentals:getById', id),
  createRental:       (data)       => ipcRenderer.invoke('rentals:create', data),
  returnRental:       (id, data)   => ipcRenderer.invoke('rentals:return', id, data),

  // Incident Reports
  createIncident:     (data)       => ipcRenderer.invoke('incidents:create', data),

  // PDF Generation
  generateMietvertrag:    (rentalId)   => ipcRenderer.invoke('pdf:mietvertrag', rentalId),
  generateRueckgabe:      (returnId)   => ipcRenderer.invoke('pdf:rueckgabe', returnId),
  generateVerlustanzeige: (incidentId) => ipcRenderer.invoke('pdf:verlustanzeige', incidentId),

  // History & Dashboard
  getAuditLog:        (filter)     => ipcRenderer.invoke('audit:getLog', filter),
  getDashboardStats:  ()           => ipcRenderer.invoke('dashboard:stats'),

  // Backup
  exportData:         ()           => ipcRenderer.invoke('backup:export'),
  importData:         ()           => ipcRenderer.invoke('backup:import'),
});
