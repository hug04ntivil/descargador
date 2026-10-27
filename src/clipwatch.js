// Vigilante del portapapeles.
// En Electron reciente clipboard.readText() devuelve una promesa, así que se espera con await.
// Si koffi está disponible se usa GetClipboardSequenceNumber de Windows: así se detecta una copia
// aunque el texto sea idéntico al anterior (p. ej. copiar de nuevo un enlace que ya se quitó).
const { clipboard } = require('electron');

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

  if (!seq) clipboard.readText().then((t) => { lastText = t; }).catch(() => {});

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (seq) {
        const s = seq();
        if (s === lastSeq) return;
        lastSeq = s;
        if (!isEnabled()) return;
        const text = await clipboard.readText();
        if (text) onText(text);
      } else {
        const text = await clipboard.readText();
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
