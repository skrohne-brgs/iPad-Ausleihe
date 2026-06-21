'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform:           process.platform,

  getSettings:        ()         => ipcRenderer.invoke('settings:get'),
  setSetting:         (k,v)      => ipcRenderer.invoke('settings:set', k, v),
  selectLogo:         ()         => ipcRenderer.invoke('settings:selectLogo'),

  getIpads:           (f)        => ipcRenderer.invoke('ipads:getAll', f),
  getIpad:            (id)       => ipcRenderer.invoke('ipads:getById', id),
  createIpad:         (d)        => ipcRenderer.invoke('ipads:create', d),
  updateIpad:         (id,d)     => ipcRenderer.invoke('ipads:update', id, d),
  deleteIpad:         (id)       => ipcRenderer.invoke('ipads:delete', id),
  deleteIpads:        (ids)      => ipcRenderer.invoke('ipads:deleteMany', ids),

  getStudents:        (f)        => ipcRenderer.invoke('students:getAll', f),
  getStudent:         (id)       => ipcRenderer.invoke('students:getById', id),
  createStudent:      (d)        => ipcRenderer.invoke('students:create', d),
  updateStudent:      (id,d)     => ipcRenderer.invoke('students:update', id, d),
  deleteStudent:      (id)       => ipcRenderer.invoke('students:delete', id),
  searchStudents:     (q)        => ipcRenderer.invoke('students:search', q),
  getClasses:         ()         => ipcRenderer.invoke('students:getClasses'),

  getRentals:         (f)        => ipcRenderer.invoke('rentals:getAll', f),
  getRental:          (id)       => ipcRenderer.invoke('rentals:getById', id),
  createRental:       (d)        => ipcRenderer.invoke('rentals:create', d),
  returnRental:       (id,d)     => ipcRenderer.invoke('rentals:return', id, d),

  createIncident:     (d)        => ipcRenderer.invoke('incidents:create', d),

  batchPlan:          (classes)  => ipcRenderer.invoke('batch:plan', classes),
  batchExecute:       (payload)  => ipcRenderer.invoke('batch:execute', payload),
  onBatchProgress:    (cb)       => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('batch:progress', handler);
    return () => ipcRenderer.removeListener('batch:progress', handler);
  },

  batchReturn:           (payload)  => ipcRenderer.invoke('batch:return', payload),
  onBatchReturnProgress: (cb)       => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('batch:return:progress', handler);
    return () => ipcRenderer.removeListener('batch:return:progress', handler);
  },

  generateMietvertrag:          (id) => ipcRenderer.invoke('pdf:mietvertrag', id),
  generateEmpfangsbestaetigung: (id) => ipcRenderer.invoke('pdf:empfangsbestaetigung', id),
  generateRueckgabe:            (id) => ipcRenderer.invoke('pdf:rueckgabe', id),
  generateVerlustanzeige:       (id) => ipcRenderer.invoke('pdf:verlustanzeige', id),

  getAuditLog:        (f)        => ipcRenderer.invoke('audit:getLog', f),
  getDashboardStats:  ()         => ipcRenderer.invoke('dashboard:stats'),

  exportData:         ()         => ipcRenderer.invoke('backup:export'),
  importData:         ()         => ipcRenderer.invoke('backup:import'),

  importRentalsCsv: (payload) => ipcRenderer.invoke('csv:rentals:import', payload),
  importCsvReturns: (payload) => ipcRenderer.invoke('csv:returns:import', payload),
  selectDir:        ()        => ipcRenderer.invoke('dialog:openDirectory'),
  printActiveList:  ()        => ipcRenderer.invoke('rentals:printActiveList'),
  onCsvImportProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('csv:rentals:import:progress', handler);
    return () => ipcRenderer.removeListener('csv:rentals:import:progress', handler);
  },
  onCsvReturnProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('csv:returns:import:progress', handler);
    return () => ipcRenderer.removeListener('csv:returns:import:progress', handler);
  },

  exportStudentsCsv:       ()    => ipcRenderer.invoke('csv:students:export'),
  importStudentsCsv:       ()    => ipcRenderer.invoke('csv:students:import'),
  downloadStudentTemplate: ()    => ipcRenderer.invoke('csv:template:students'),
  exportIpadsCsv:          ()    => ipcRenderer.invoke('csv:ipads:export'),
  importIpadsCsv:          ()    => ipcRenderer.invoke('csv:ipads:import'),
  downloadIpadTemplate:    ()    => ipcRenderer.invoke('csv:template:ipads'),

  webdavTest:         (params)   => ipcRenderer.invoke('webdav:test', params),
  webdavSync:         ()         => ipcRenderer.invoke('webdav:sync'),
  webdavDownload:     ()         => ipcRenderer.invoke('webdav:download'),

  printQrStickers:    (ids)      => ipcRenderer.invoke('qr:stickerSheet', ids),
  generateQrDataUrl:  (tag)      => ipcRenderer.invoke('qr:generate', tag),
});
