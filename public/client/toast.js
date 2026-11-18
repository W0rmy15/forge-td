// Forge TD client: toast queue (bottom message strip). Exposes FTD.toast(msg, info, key, urgent) and FTD.toastHas(key).
(() => {
  const FTD = window.FTD = window.FTD || {};
  const $ = (id) => document.getElementById(id);
  // toast queue: messages are shown one after another instead of overwriting each other.
  // A toast with a key replaces a queued (or showing) toast with the same key, so bursts (e.g. enemy sends) coalesce.
  const toastQ = []; let toastCur = null, toastTimer = null;
  // urgent (errors): queued ahead of info toasts, and an info toast that is showing is cut short for it
  function toast(msg, info, key, urgent) {
    const item = { msg, info: !!info, key: key || null, urgent: !!urgent };
    if (key) {
      if (toastCur && toastCur.key === key) { toastCur.msg = msg; paintToast(); return; }
      const i = toastQ.findIndex((x) => x.key === key); if (i >= 0) { toastQ[i] = item; return; }
    }
    if (toastQ.length >= 4) { const i = toastQ.findIndex((x) => x.info); toastQ.splice(i >= 0 ? i : 0, 1); } // keep it short
    if (urgent) { const i = toastQ.findIndex((x) => !x.urgent); toastQ.splice(i >= 0 ? i : toastQ.length, 0, item); }
    else toastQ.push(item);
    if (!toastCur) nextToast();
    else if (urgent && toastCur.info) { clearTimeout(toastTimer); toastTimer = setTimeout(nextToast, Math.max(0, 350 - (performance.now() - toastCur.at))); }
  }
  function toastHas(key) { return (toastCur && toastCur.key === key) || toastQ.some((x) => x.key === key); }
  function paintToast() { const t = $('toast'); t.textContent = toastCur.msg; t.className = 'show' + (toastCur.info ? ' info' : ''); }
  function nextToast() {
    clearTimeout(toastTimer);
    toastCur = toastQ.shift() || null;
    if (!toastCur) { $('toast').className = ''; return; }
    toastCur.at = performance.now();
    paintToast();
    toastTimer = setTimeout(nextToast, toastQ.length ? 1100 : 1800);
  }
  window.__ftdToasts = () => ({ cur: toastCur && toastCur.msg, queued: toastQ.map((x) => x.msg) }); // read-only hook for the smoke test
  FTD.toast = toast; FTD.toastHas = toastHas;
})();
