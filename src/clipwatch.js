// Vigilante del portapapeles.
// En Electron reciente clipboard.readText() devuelve una promesa, así que se espera con await.
// Si koffi está disponible se usa GetClipboardSequenceNumber de Windows: así se detecta una copia
// aunque el texto sea idéntico al anterior (p. ej. copiar de nuevo un enlace que ya se quitó).
const { clipboard } = require('electron');

// readText() podría quedarse esperando si otra aplicación tiene el portapapeles bloqueado;
// sin este límite el vigilante se quedaría "ocupado" para siempre y dejaría de detectar enlaces.
function readTextSafe(ms = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('portapapeles bloqueado')), ms); });
  return Promise.race([clipboard.readText(), timeout]).finally(() => clearTimeout(timer));
}

function loadSequenceFn() {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    return user32.func('uint32_t __stdcall GetClipboardSequenceNumber()');
  } catch {
    return null;
  }
}

/**
 * @param {(text:string)=>void} onText   se llama con el texto nuevo del portapapeles
 * @param {()=>boolean} isEnabled
 * @returns {{stop:()=>void, mode:string}}
 */
function watchClipboard(onText, isEnabled, intervalMs = 600) {
  const seq = loadSequenceFn();
  let lastSeq = seq ? seq() : null;
  let lastText = null;
  let busy = false;

  if (!seq) readTextSafe().then((t) => { lastText = t; }).catch(() => {});

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (seq) {
        const s = seq();
        if (s === lastSeq) return;
        lastSeq = s;
        if (!isEnabled()) return;
        const text = await readTextSafe();
        if (text) onText(text);
      } else {
        const text = await readTextSafe();
        if (text === lastText) return;
        lastText = text;
        if (text && isEnabled()) onText(text);
      }
    } catch {
      // El portapapeles puede estar bloqueado por otra aplicación; se reintenta en el siguiente ciclo.
    } finally {
      busy = false;
    }
  }, intervalMs);

  return { stop: () => clearInterval(timer), mode: seq ? 'sequence' : 'text' };
}

module.exports = { watchClipboard };
