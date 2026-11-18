// Forge TD client: screen-fit layout + fullscreen (v0.6).
//
// The game is drawn in a fixed LOGICAL coordinate space of FTD.layout.W x FTD.layout.H (760 x 660) by client.js.
// This file only decides how big that canvas is on screen: the largest size that fits next to the side panel
// (aspect kept, so letterboxing is at most one thin strip), recomputed on window resize, fullscreen changes,
// zoom / devicePixelRatio changes, and whenever the panel or the sudden-death banner changes size.
//
// For Forge Art (style.css owner): nothing here sets colours, borders or fonts. Layout hooks you can style:
//   - CSS variables on <html>: --ftd-board-w / --ftd-board-h (on-screen canvas size, px) and --ftd-scale.
//   - #panel gets an inline max-height = canvas height (+ overflow-y:auto) so the HUD never runs off-screen.
//   - <body> gets class "ftd-fs" while in fullscreen.
//   - An optional button with id="fsBtn" (anywhere in the page) toggles fullscreen when clicked; the F key does too.
// The fit reads the real panel width / canvas border / paddings from the DOM, so restyling them stays correct.
(() => {
  const FTD = window.FTD = window.FTD || {};
  const $ = (id) => document.getElementById(id);
  const W = 760, H = 660, MIN_SCALE = 0.5, MAX_SCALE = 4;
  const subs = [];
  const L = FTD.layout = { W, H, scale: 1, onChange(cb) { subs.push(cb); }, fit, toggleFullscreen };

  function px(el, prop) { return el ? parseFloat(getComputedStyle(el)[prop]) || 0 : 0; }
  function fit() {
    const game = $('game'), cv = $('cv'), panel = $('panel');
    if (!game || !cv || game.classList.contains('hidden')) return;
    const wrap = cv.parentElement;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const borderX = cv.offsetWidth - cv.clientWidth, borderY = cv.offsetHeight - cv.clientHeight;
    const padX = px(game, 'paddingLeft') + px(game, 'paddingRight'), padY = px(game, 'paddingTop') + px(game, 'paddingBottom');
    const gap = px(wrap, 'columnGap') || px(wrap, 'gap');
    const banner = $('sdBanner');
    const bannerH = banner && !banner.classList.contains('hidden') ? banner.offsetHeight + px(banner, 'marginTop') + px(banner, 'marginBottom') : 0;
    const shadow = 8; // room for the canvas drop shadow
    const panelW = panel ? panel.offsetWidth : 0;
    let availW = vw - padX - borderX - panelW - gap - 2;
    const availH = vh - padY - borderY - bannerH - shadow;
    // very narrow windows: the panel wraps under the board (flex-wrap), so the board may use the full width
    const stacked = availW < W * MIN_SCALE;
    if (stacked) availW = vw - padX - borderX - 2;
    let s = Math.min(availW / W, stacked ? 1e9 : availH / H);
    s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    s = Math.floor(s * 1000) / 1000;
    const changed = s !== L.scale;
    L.scale = s;
    const root = document.documentElement.style;
    root.setProperty('--ftd-scale', String(s));
    root.setProperty('--ftd-board-w', Math.round(W * s) + 'px');
    root.setProperty('--ftd-board-h', Math.round(H * s) + 'px');
    if (wrap) wrap.style.flexWrap = stacked ? 'wrap' : '';
    if (panel) { panel.style.maxHeight = stacked ? '' : Math.round(H * s + borderY) + 'px'; panel.style.overflowY = stacked ? '' : 'auto'; }
    if (changed || L._dpr !== window.devicePixelRatio) { L._dpr = window.devicePixelRatio; for (const cb of subs) try { cb(L); } catch (e) { console.error(e); } }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
  window.addEventListener('resize', schedule);
  document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('ftd-fs', !!document.fullscreenElement); schedule(); });
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(schedule);
    const watch = () => { for (const id of ['panel', 'sdBanner', 'game']) if ($(id)) ro.observe($(id)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  }
  // banner show/hide is a class flip (no size change while hidden): watch it too
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(schedule);
    const watch = () => { for (const id of ['sdBanner', 'game']) if ($(id)) mo.observe($(id), { attributes: true, attributeFilter: ['class'] }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } catch (e) { /* fullscreen not allowed here: ignore */ }
  }
  document.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('#fsBtn'); if (b) { toggleFullscreen(); b.blur(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    const game = $('game'); if (!game || game.classList.contains('hidden')) return;
    toggleFullscreen();
  });
})();
