// Puente Android: implementa el mismo `window.api` que preload.js en el escritorio,
// pero hablando con la clase Kotlin `Bridge` (expuesta como `Android`).
(function () {
  'use strict';
  window.__ANDROID__ = true;
  document.documentElement.classList.add('android');

  let nextId = 1;
  const pending = new Map();
  const listeners = {};

  // Lo invoca Kotlin: resolve() responde a una llamada, emit() empuja eventos.
  window.__native = {
    resolve(id, json) {
      const done = pending.get(id);
      if (done) { pending.delete(id); done(JSON.parse(json).v); }
    },
    emit(channel, json) {
      const v = JSON.parse(json).v;
      (listeners[channel] || []).slice().forEach((cb) => cb(v));
    },
  };

  // El botón "atrás": cierra un diálogo abierto; si no hay, Kotlin manda la app al fondo.
  window.__back = function () {
    const d = document.querySelector('dialog[open]');
    if (d) { d.close(); return true; }
    return false;
  };

  const call = (method, ...args) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    Android.call(id, method, JSON.stringify(args));
  });
  const send = (method, ...args) => Android.send(method, JSON.stringify(args));
  const on = (channel) => (cb) => {
    (listeners[channel] = listeners[channel] || []).push(cb);
    return () => { listeners[channel] = listeners[channel].filter((f) => f !== cb); };
  };

  window.api = {
    init: () => call('init'),
    add: (text, format) => call('add', text, format),
    pasteClipboard: () => call('pasteClipboard'),
    choiceConfirm: (id, indexes) => send('choiceConfirm', id, indexes),
    choiceSingle: (id) => send('choiceSingle', id),
    choiceCancel: (id) => send('choiceCancel', id),
    chooseCookiesFile: () => call('chooseCookiesFile'),
    pause: (id) => send('pause', id),
    resume: (id) => send('resume', id),
    retry: (id) => send('retry', id),
    remove: (id) => send('remove', id),
    pauseAll: () => send('pauseAll'),
    resumeAll: () => send('resumeAll'),
    clearCompleted: () => send('clearCompleted'),
    showFile: (file) => send('showFile', file),
    openFile: (file) => send('openFile', file),
    openOutput: () => send('openOutput'),
    openExternal: (url) => send('openExternal', url),
    chooseFolder: () => Promise.resolve(null),
    saveSettings: (patch) => call('saveSettings', patch),
    updateYtdlp: () => call('updateYtdlp'),
    getVersion: () => call('version'),
    onItems: on('items'),
    onRemove: on('remove'),
    onStats: on('stats'),
    onNotice: on('notice'),
    onChoose: on('choose'),
  };
})();
