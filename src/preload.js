const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  add: (text, format) => ipcRenderer.invoke('add', text, format),
  choiceConfirm: (id, indexes) => ipcRenderer.send('choice-confirm', id, indexes),
  choiceSingle: (id) => ipcRenderer.send('choice-single', id),
  choiceCancel: (id) => ipcRenderer.send('choice-cancel', id),
  chooseCookiesFile: () => ipcRenderer.invoke('choose-cookies-file'),
  onChoose: (cb) => on('choose', cb),
  pause: (id) => ipcRenderer.send('pause', id),
  resume: (id) => ipcRenderer.send('resume', id),
  retry: (id) => ipcRenderer.send('retry', id),
  remove: (id) => ipcRenderer.send('remove', id),
  pauseAll: () => ipcRenderer.send('pause-all'),
  resumeAll: () => ipcRenderer.send('resume-all'),
  clearCompleted: () => ipcRenderer.send('clear-completed'),
  showFile: (file) => ipcRenderer.send('show-file', file),
  openFile: (file) => ipcRenderer.send('open-file', file),
  openOutput: () => ipcRenderer.send('open-output'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  updateYtdlp: () => ipcRenderer.invoke('update-ytdlp'),
  onItems: (cb) => on('items:update', cb),
  onRemove: (cb) => on('items:remove', cb),
  onStats: (cb) => on('stats', cb),
  onNotice: (cb) => on('notice', cb),
});
