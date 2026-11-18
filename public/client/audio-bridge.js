// Forge TD client: bridge to Forge Sound's public hooks (window.forgeAudio, fallback window.audio) + the mute/volume UI.
// Every call is guarded, so a missing or broken audio.js can never break the game. Exposes FTD.aud(name, opts) and FTD.audApi().
(() => {
  const FTD = window.FTD = window.FTD || {};
  const $ = (id) => document.getElementById(id);
  function audApi() {
    const a = (window.forgeAudio && typeof window.forgeAudio.play === 'function') ? window.forgeAudio
      : (window.audio && typeof window.audio.play === 'function') ? window.audio : null;
    return a && typeof a.getVolume === 'function' && typeof a.isMuted === 'function' ? a : (a && typeof a.play === 'function' ? a : null);
  }
  function aud(name, opts) { try { const a = audApi(); if (a && typeof a.play === 'function') a.play(name, opts); } catch (e) {} }
  (function setupAudioUi() {
    const muteBtn = $('muteBtn'), slider = $('volSlider');
    if (!muteBtn || !slider) return;
    const paint = () => {
      try {
        const a = audApi();
        if (!a || typeof a.getVolume !== 'function' || typeof a.isMuted !== 'function') return;
        slider.value = Math.round(a.getVolume() * 100);
        muteBtn.textContent = a.isMuted() ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-pressed', a.isMuted() ? 'true' : 'false');
      } catch (e) { /* foreign window.audio must never break the client */ }
    };
    const blurAud = () => { try { muteBtn.blur(); slider.blur(); } catch (e) {} };
    muteBtn.onclick = () => { try { const a = audApi(); if (a) { if (a.unlock) a.unlock(); if (a.toggleMute) a.toggleMute(); } } catch (e) {} aud('ui_click'); paint(); blurAud(); };
    slider.oninput = () => { try { const a = audApi(); if (a) { if (a.unlock) a.unlock(); if (a.setVolume) a.setVolume(+slider.value / 100); } } catch (e) {} paint(); };
    muteBtn.addEventListener('pointerup', blurAud);
    slider.addEventListener('pointerup', blurAud);
    slider.addEventListener('change', blurAud);
    slider.addEventListener('keyup', blurAud);
    paint();
  })();

  // Music volume / mute (optional hooks from Forge Sound's MUSIC-HOOKS.md). Guarded like the SFX controls.
  (function setupMusicUi() {
    const btn = $('musicBtn'), slider = $('musicSlider');
    if (!btn || !slider) return;
    const music = () => { const a = window.forgeAudio; return a && typeof a.getMusicVolume === 'function' ? a : null; };
    const paint = () => {
      try {
        const a = music(); if (!a) return;
        slider.value = Math.round(a.getMusicVolume() * 100);
        const muted = typeof a.isMusicMuted === 'function' && a.isMusicMuted();
        btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
        btn.title = muted ? 'Music muted' : 'Music';
      } catch (e) {}
    };
    const blur = () => { try { btn.blur(); slider.blur(); } catch (e) {} };
    btn.onclick = () => { try { const a = music(); if (a) { if (a.unlock) a.unlock(); if (a.toggleMusicMute) a.toggleMusicMute(); } } catch (e) {} aud('ui_click'); paint(); blur(); };
    slider.oninput = () => { try { const a = music(); if (a) { if (a.unlock) a.unlock(); if (a.setMusicVolume) a.setMusicVolume(+slider.value / 100); } } catch (e) {} paint(); };
    btn.addEventListener('pointerup', blur);
    slider.addEventListener('pointerup', blur);
    slider.addEventListener('change', blur);
    slider.addEventListener('keyup', blur);
    paint();
  })();

  FTD.audApi = audApi; FTD.aud = aud;
})();
