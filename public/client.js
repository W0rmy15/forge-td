(() => {
  const S = window.SHARED;
  const $ = (id) => document.getElementById(id);
  const CELL = 30, TOP = 44;
  const BX = { L: 20, R: 20 + S.COLS * CELL + 60 };
  const TEAMCOL = { L: '#4fa3ff', R: '#ff5d5d' };

  let ws = null, you = null, code = null, lobby = null;
  let rejoinCode = null, retries = 0, retryTimer = null; // reconnect state (kept across retries)
  let rosterSig = '', sellArm = null; // sellArm: {c,r,until} for two-step sell
  let state = null, prevState = null, stateAt = 0;
  let buildType = null, selected = null, hover = null; // hover: {b,c,r,fx,fy}
  let fx = []; // visual effects
  let distCache = { sig: '', L: null, R: null };

  // ---------- menu ----------
  $('name').value = localStorage.getItem('ftd_name') || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();
  const nameVal = () => { const n = $('name').value.trim() || 'Player'; localStorage.setItem('ftd_name', n); return n; };
  $('createBtn').onclick = () => { stopRetry(); connect(() => sendMsg({ t: 'create', name: nameVal() })); };
  $('joinBtn').onclick = () => {
    const c = $('codeInput').value.trim().toUpperCase();
    if (c.length !== 4) return ($('menuErr').textContent = 'Enter a 4-letter room code');
    stopRetry();
    connect(() => sendMsg({ t: 'join', code: c, name: nameVal(), token: localStorage.getItem('ftd_token_' + c) }));
  };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

  function connect(onOpen) {
    if (ws && ws.readyState === 1) return onOpen();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}`);
    ws = sock;
    sock.onopen = onOpen;
    sock.onmessage = (e) => { if (ws === sock) onMsg(JSON.parse(e.data)); };
    sock.onclose = () => {
      if (ws !== sock) return;
      if (code) rejoinCode = code; // keep the room code across retries
      code = null;
      if (rejoinCode) scheduleRetry();
    };
  }
  // reconnect with exponential backoff (1 s, 2 s, 4 s ... max 15 s), up to ~2 minutes
  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (retries >= 12) { toast('Could not reconnect. Check your connection and rejoin.'); rejoinCode = null; retries = 0; show('menu'); return; }
    const delay = Math.min(15000, 1000 * Math.pow(2, retries)); retries++;
    toast(`Disconnected — reconnecting in ${Math.round(delay / 1000)}s…`);
    retryTimer = setTimeout(() => {
      const c = rejoinCode; if (!c) return;
      connect(() => sendMsg({ t: 'join', code: c, name: nameVal(), token: localStorage.getItem('ftd_token_' + c) }));
    }, delay);
  }
  function stopRetry() { clearTimeout(retryTimer); rejoinCode = null; retries = 0; }
  function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function onMsg(m) {
    if (m.t === 'joined') {
      you = m.you; code = m.code; rejoinCode = null; retries = 0; clearTimeout(retryTimer);
      if (m.rejoined) toast('Reconnected', true);
      localStorage.setItem('ftd_token_' + code, m.token);
      history.replaceState(null, '', '?room=' + code);
    } else if (m.t === 'lobby') { lobby = m; renderLobby(); }
    else if (m.t === 's') {
      // static tower lists are only sent when they change: reuse the last ones we have
      for (const b of ['L', 'R']) if (!m.boards[b].towers) m.boards[b].towers = state && state.boards[b].towers ? state.boards[b].towers : [];
      prevState = state; state = m; stateAt = performance.now(); onState(m);
    }
    else if (m.t === 'err') {
      toast(m.msg);
      if (m.code === 'noroom') { // room is gone: stop retrying and go back to the menu
        const c = rejoinCode || code; stopRetry(); code = null; state = null; lobby = null;
        if (c) localStorage.removeItem('ftd_token_' + c);
        history.replaceState(null, '', location.pathname);
        show('menu'); $('menuErr').textContent = m.msg;
      } else if (!code) $('menuErr').textContent = m.msg;
    }
    else if (m.t === 'chat') addChat(m);
  }

  // ---------- lobby ----------
  $('copyBtn').onclick = () => { $('shareLink').select(); navigator.clipboard && navigator.clipboard.writeText($('shareLink').value); toast('Link copied', true); };
  document.querySelectorAll('.teamBtn').forEach((b) => (b.onclick = () => sendMsg({ t: 'team', team: b.dataset.team })));
  $('readyBtn').onclick = () => { const me = lobby.players.find((p) => p.id === you); sendMsg({ t: 'ready', ready: !(me && me.ready) }); };
  $('startBtn').onclick = () => sendMsg({ t: 'start' });
  $('backBtn').onclick = () => sendMsg({ t: 'lobby' });

  function show(id) { for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderLobby() {
    if (lobby.phase === 'lobby') {
      show('lobby'); $('over').classList.add('hidden'); state = null; selected = null; buildType = null;
      $('lobbyCode').textContent = lobby.code;
      $('shareLink').value = `${location.origin}${location.pathname}?room=${lobby.code}`;
      for (const t of ['L', 'R']) {
        $('team' + t).innerHTML = lobby.players.filter((p) => p.team === t).map((p) =>
          `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === you ? ' (you)' : ''}${p.id === lobby.hostId ? ' 👑' : ''} ${p.id === lobby.hostId ? '' : p.ready ? '✅' : '⏳'}</li>`).join('');
      }
      const me = lobby.players.find((p) => p.id === you);
      const isHost = lobby.hostId === you;
      $('readyBtn').classList.toggle('hidden', isHost);
      $('readyBtn').textContent = me && me.ready ? 'Not ready' : 'Ready';
      $('startBtn').classList.toggle('hidden', !isHost);
      const nL = lobby.players.filter((p) => p.team === 'L').length, nR = lobby.players.filter((p) => p.team === 'R').length;
      const allReady = lobby.players.every((p) => p.ready || p.id === lobby.hostId || !p.connected);
      const canStart = nL > 0 && nL === nR && allReady;
      $('startBtn').disabled = !canStart;
      $('lobbyErr').textContent = canStart || !isHost ? '' : nL !== nR || !nL ? `Teams must be even and non-empty (now ${nL}v${nR}).` : 'Waiting for everyone to be ready.';
    } else {
      show('game');
      rosterSig = '';
      const isHost = lobby.hostId === you;
      $('backBtn').classList.toggle('hidden', !isHost);
      $('overWait').classList.toggle('hidden', isHost);
    }
  }

  // ---------- game UI ----------
  const buildBtns = {}, sendBtns = {};
  for (const [k, t] of Object.entries(S.TOWERS)) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="k">${t.key}</span> ${t.name}<br>${t.cost}g`; b.title = t.desc;
    b.onclick = () => { buildType = buildType === k ? null : k; selected = null; };
    $('buildBtns').appendChild(b); buildBtns[k] = b;
  }
  for (const [k, t] of Object.entries(S.SENDS)) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="k">${t.key.toUpperCase()}</span> ${t.name}<br>${t.cost}g +${t.income}`; b.title = `${t.desc}: ${t.count}× ${Math.round(t.hpMult * 100)}% of a wave creep's HP. Income gain shrinks as your send income grows.`;
    b.onclick = () => sendMsg({ t: 'send', kind: k });
    $('sendBtns').appendChild(b); sendBtns[k] = b;
  }

  function me() { return state && state.players.find((p) => p.id === you); }

  function onState(s) {
    const m = me();
    if (!m) return;
    $('gold').textContent = m.gold; $('income').textContent = m.income;
    $('nextIncome').textContent = Math.ceil(s.nextIncome) + 's';
    $('wave').textContent = s.wave; $('nextWave').textContent = Math.ceil(s.nextWave) + 's';
    for (const [k, t] of Object.entries(S.TOWERS)) { buildBtns[k].classList.toggle('active', buildType === k); buildBtns[k].disabled = m.gold < t.cost; }
    const capped = (m.sw || 0) >= S.SEND_CAP_PER_WAVE;
    for (const [k, t] of Object.entries(S.SENDS)) sendBtns[k].disabled = m.gold < t.cost || capped;
    $('sendsWave').textContent = `${m.sw || 0}/${S.SEND_CAP_PER_WAVE}`;
    const enemy = m.team === 'L' ? 'R' : 'L';
    $('sendsQueued').textContent = s.boards[enemy].queuedSends || 0;
    $('sendsOnMe').textContent = s.boards[m.team].queuedSends || 0;
    // roster: only touch the DOM when something visible changed
    const sig = JSON.stringify([s.boards.L.lives, s.boards.R.lives, s.players.map((p) => [p.id, p.name, p.team, p.connected, p.gold, p.income])]);
    if (sig !== rosterSig) {
      rosterSig = sig;
      $('roster').innerHTML = ['L', 'R'].map((t) =>
        `<div style="color:${TEAMCOL[t]}"><b>${t === 'L' ? 'Left' : 'Right'}</b> — ❤️ ${s.boards[t].lives}</div>` +
        s.players.filter((p) => p.team === t).map((p) =>
          `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === you ? ' (you)' : ''}${p.connected ? '' : ' (offline)'} ${p.gold !== undefined ? `· ${p.gold}g` : ''} · +${p.income}</div>`).join('')).join('');
    }
    // selection panel
    renderSel();
    // effects from events
    for (const e of s.ev) {
      if (e.k === 'shot') fx.push({ k: 'shot', ...e, t0: performance.now(), dur: e.tt === 'cannon' ? 220 : 120 });
      else if (e.k === 'boom' || e.k === 'chill') fx.push({ ...e, t0: performance.now(), dur: 300 });
      else if (e.k === 'sudden') toast('SUDDEN DEATH: waves get much stronger and leaks cost double!');
      else if (e.k === 'send' && e.id === you) { toast(`Sent ${S.SENDS[e.kind].name}${S.SENDS[e.kind].count > 1 ? ' ×' + S.SENDS[e.kind].count : ''} (${e.n}/${S.SEND_CAP_PER_WAVE} this wave)`, true); flashBtn(sendBtns[e.kind]); }
      else if (e.k === 'send' && e.team === m.team) toast(`${e.name} sent ${S.SENDS[e.kind].name}`, true);
      else if (e.k === 'wave') toast(e.boss ? `Wave ${e.n}: BOSS incoming!` : `Wave ${e.n} incoming`, true);
      else if (e.k === 'send' && e.team !== m.team) toast(`${e.name} sent ${S.SENDS[e.kind].name}s at you!`);
    }
    if (s.phase === 'over' || s.winner) {
      $('over').classList.remove('hidden');
      $('overText').textContent = s.winner === 'draw' ? 'Draw!' : s.winner === m.team ? '🏆 Victory!' : '💀 Defeat';
      $('overReason').textContent = s.winReason || '';
      $('overStats').innerHTML = s.players.map((p) => `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)} (${p.team}) — kills ${p.kills}, sent ${p.sent}, income ${p.income}</div>`).join('');
    } else $('over').classList.add('hidden');
  }

  function flashBtn(b) { if (!b) return; b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 250); }
  function towerAt(b, c, r) { if (!state) return null; const t = state.boards[b].towers.find((t) => t[1] === c && t[2] === r); return t ? { id: t[0], c: t[1], r: t[2], type: t[3], lvl: t[4], owner: t[5], selling: !!t[6] } : null; }

  function renderSel() {
    const m = me();
    const el = $('sel');
    if (!selected || !m) { el.classList.add('hidden'); return; }
    const t = towerAt(m.team, selected.c, selected.r);
    if (!t) { selected = null; el.classList.add('hidden'); return; }
    const spec = S.TOWERS[t.type], st = spec.levels[t.lvl];
    const up = S.upgradeCost(t.type, t.lvl), sell = Math.floor(S.towerSpent(t.type, t.lvl) * S.SELL_REFUND);
    const mine = t.owner === you;
    const owner = state.players.find((p) => p.id === t.owner);
    const nx = up !== null ? spec.levels[t.lvl + 1] : null;
    const armed = sellArm && sellArm.c === t.c && sellArm.r === t.r && performance.now() < sellArm.until;
    const busy = state.boards[m.team].creeps.length > 0;
    const html = `<b>${spec.name}</b> Lv ${t.lvl + 1}/3 ${mine ? '' : `<small>(${esc(owner ? owner.name : '?')}'s)</small>`}<br>
      <small>Dmg ${st.dmg}${nx ? '→' + nx.dmg : ''} · Range ${st.range}${st.splash ? ' · Splash ' + st.splash : ''}${st.slow ? ' · Slow ' + Math.round(st.slow * 100) + '% (area ' + st.area + ')' : ''}</small>
      ${t.selling ? '<div class="row"><small>Selling…</small></div>' : mine ? `<div class="row"><button id="upBtn" ${up === null || m.gold < up ? 'disabled' : ''}>[U] Upgrade ${up === null ? 'MAX' : up + 'g'}</button><button id="sellBtn" class="${armed ? 'danger' : ''}">${armed ? 'Confirm sell?' : `[X] Sell ${sell}g`}</button></div>${busy ? `<small class="hint">Creeps on board: sale takes ${S.SELL_DELAY}s, tower stops firing</small>` : ''}` : ''}`;
    if (el.dataset.html !== html) {
      el.innerHTML = html; el.dataset.html = html;
      if ($('upBtn')) $('upBtn').onclick = doUpgrade; if ($('sellBtn')) $('sellBtn').onclick = doSell;
    }
    el.classList.remove('hidden');
  }
  function doUpgrade() { if (selected) sendMsg({ t: 'upgrade', c: selected.c, r: selected.r }); }
  // two-step sell: first press arms, second press within 2.5 s confirms
  function doSell() {
    if (!selected) return;
    const now = performance.now();
    if (sellArm && sellArm.c === selected.c && sellArm.r === selected.r && now < sellArm.until) {
      sendMsg({ t: 'sell', c: selected.c, r: selected.r }); sellArm = null; selected = null;
    } else { sellArm = { c: selected.c, r: selected.r, until: now + 2500 }; toast('Press X / Sell again to confirm', true); setTimeout(renderSel, 2600); }
    renderSel();
  }

  // ---------- input ----------
  const cv = $('cv'), ctx = cv.getContext('2d');
  function cellFromEvent(e) {
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (cv.width / rect.width), y = (e.clientY - rect.top) * (cv.height / rect.height);
    for (const b of ['L', 'R']) {
      const fxp = (x - BX[b]) / CELL, fyp = (y - TOP) / CELL;
      if (fxp >= 0 && fyp >= 0 && fxp < S.COLS && fyp < S.ROWS) return { b, c: Math.floor(fxp), r: Math.floor(fyp), fx: fxp, fy: fyp };
    }
    return null;
  }
  let lastCursorSend = 0;
  cv.addEventListener('mousemove', (e) => {
    hover = cellFromEvent(e);
    const now = performance.now();
    if (now - lastCursorSend > 80) { lastCursorSend = now; sendMsg(hover ? { t: 'cursor', b: hover.b, c: hover.fx, r: hover.fy } : { t: 'cursor', c: null }); }
  });
  cv.addEventListener('mouseleave', () => { hover = null; sendMsg({ t: 'cursor', c: null }); });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); buildType = null; selected = null; });
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !state) return;
    const h = cellFromEvent(e), m = me();
    if (!h || !m) return;
    if (h.b !== m.team) { toast("That's the enemy side — build on your own maze"); return; }
    const t = towerAt(h.b, h.c, h.r);
    if (t) { selected = { c: h.c, r: h.r }; buildType = null; return; }
    if (buildType) { sendMsg({ t: 'build', type: buildType, c: h.c, r: h.r }); if (!e.shiftKey && false) buildType = null; }
    else selected = null;
  });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Enter' && document.activeElement.id === 'chatInput') {
        const v = $('chatInput').value.trim(); if (v) sendMsg({ t: 'chat', text: v }); $('chatInput').value = ''; $('chatInput').blur();
      }
      return;
    }
    if (!state) return;
    const k = e.key.toLowerCase();
    for (const [id, t] of Object.entries(S.TOWERS)) if (k === t.key) { buildType = buildType === id ? null : id; selected = null; }
    for (const [id, t] of Object.entries(S.SENDS)) if (k === t.key) sendMsg({ t: 'send', kind: id });
    if (k === 'u') doUpgrade();
    if (k === 'x' || k === 'delete') doSell();
    if (k === 'escape') { buildType = null; selected = null; }
    if (k === 'enter') $('chatInput').focus();
  });

  function addChat(m) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:${m.color}">${esc(m.name)}:</b> ${esc(m.text)}`;
    $('chatLog').appendChild(d); $('chatLog').scrollTop = 1e9;
  }

  let toastTimer;
  function toast(msg, info) {
    const t = $('toast'); t.textContent = msg; t.className = 'show' + (info ? ' info' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 1800);
  }

  // ---------- rendering ----------
  function dists() {
    const sig = ['L', 'R'].map((b) => state.boards[b].towers.map((t) => t[1] + ',' + t[2]).join(';')).join('|');
    if (sig !== distCache.sig) {
      distCache.sig = sig;
      for (const b of ['L', 'R']) { const set = new Set(state.boards[b].towers.map((t) => t[1] + ',' + t[2])); distCache[b] = S.computeDist((c, r) => set.has(c + ',' + r)); }
    }
    return distCache;
  }
  // mirrors the server's canBuild: spawn/base, path blocking, and creeps in the cell or trapped by it
  function wouldBlock(b, c, r) {
    if ((c === S.SPAWN.c && r === S.SPAWN.r) || (c === S.BASE.c && r === S.BASE.r)) return true;
    const creeps = state.boards[b].creeps;
    for (const cr of creeps) { // creep occupies the cell it is in (or is about to enter)
      const cc = Math.floor(cr[2]), rr = Math.floor(cr[3]);
      if (Math.abs(cr[2] - (c + 0.5)) < 1 && Math.abs(cr[3] - (r + 0.5)) < 1 && (cc === c || rr === r)) return true;
    }
    const set = new Set(state.boards[b].towers.map((t) => t[1] + ',' + t[2])); set.add(c + ',' + r);
    const d = S.computeDist((cc, rr) => set.has(cc + ',' + rr));
    if (d[S.SPAWN.c + S.SPAWN.r * S.COLS] < 0) return true;
    for (const cr of creeps) { const cc = Math.floor(cr[2]), rr = Math.floor(cr[3]); if (cc >= 0 && rr >= 0 && cc < S.COLS && rr < S.ROWS && d[cc + rr * S.COLS] < 0) return true; }
    return false;
  }

  function drawTower(x, y, type, lvl, ownerColor, alpha) {
    const spec = S.TOWERS[type];
    ctx.save(); ctx.globalAlpha = alpha || 1;
    ctx.fillStyle = '#20262f'; ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.strokeStyle = ownerColor; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
    const cx = x + CELL / 2, cy = y + CELL / 2, s = 8 + lvl * 1.5;
    ctx.fillStyle = spec.color; ctx.beginPath();
    if (type === 'arrow') { ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy + s * 0.8); ctx.lineTo(cx - s, cy + s * 0.8); ctx.closePath(); ctx.fill(); }
    else if (type === 'cannon') { ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3a3f48'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.45, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (let i = 0; i <= lvl; i++) ctx.fillRect(x + 5 + i * 6, y + CELL - 7, 4, 3);
    ctx.restore();
  }
  function rangeCircle(b, c, r, range, ok) {
    ctx.beginPath(); ctx.arc(BX[b] + (c + 0.5) * CELL, TOP + (r + 0.5) * CELL, range * CELL, 0, Math.PI * 2);
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.07)' : 'rgba(255,60,60,0.08)'; ctx.fill();
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.45)' : 'rgba(255,80,80,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function render() {
    requestAnimationFrame(render);
    if (!state) return;
    const now = performance.now();
    const alpha = Math.min(1, (now - stateAt) / 50);
    const m = me();
    const pmap = new Map(state.players.map((p) => [p.id, p]));
    const d = dists();
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const b of ['L', 'R']) {
      const B = state.boards[b], x0 = BX[b];
      // header
      ctx.fillStyle = TEAMCOL[b]; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(`${b === 'L' ? 'LEFT' : 'RIGHT'}${m && m.team === b ? ' (your side)' : ''}`, x0, 20);
      ctx.textAlign = 'right'; ctx.fillStyle = B.leak ? '#ff5050' : '#fff';
      ctx.fillText(`❤️ ${B.lives}`, x0 + S.COLS * CELL, 20);
      ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillStyle = '#7d8698';
      ctx.fillText(state.players.filter((p) => p.team === b).map((p) => p.name).join(' & '), x0, 36);
      // grid
      ctx.fillStyle = b === 'L' ? '#121a26' : '#1f1418'; ctx.fillRect(x0, TOP, S.COLS * CELL, S.ROWS * CELL);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      for (let c = 0; c <= S.COLS; c++) { ctx.beginPath(); ctx.moveTo(x0 + c * CELL + 0.5, TOP); ctx.lineTo(x0 + c * CELL + 0.5, TOP + S.ROWS * CELL); ctx.stroke(); }
      for (let r = 0; r <= S.ROWS; r++) { ctx.beginPath(); ctx.moveTo(x0, TOP + r * CELL + 0.5); ctx.lineTo(x0 + S.COLS * CELL, TOP + r * CELL + 0.5); ctx.stroke(); }
      if (B.leak) { ctx.fillStyle = 'rgba(255,0,0,0.12)'; ctx.fillRect(x0, TOP, S.COLS * CELL, S.ROWS * CELL); }
      // path preview
      let pc = S.SPAWN.c, pr = S.SPAWN.r, guard = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      while (guard++ < 300) { const n = S.nextCell(d[b], pc, pr); if (!n) break; ctx.beginPath(); ctx.arc(x0 + (n.c + 0.5) * CELL, TOP + (n.r + 0.5) * CELL, 2.5, 0, 7); ctx.fill(); pc = n.c; pr = n.r; }
      // spawn & base
      ctx.fillStyle = '#6c3fc4'; ctx.fillRect(x0 + S.SPAWN.c * CELL + 3, TOP + S.SPAWN.r * CELL + 3, CELL - 6, CELL - 6);
      ctx.fillStyle = TEAMCOL[b]; ctx.fillRect(x0 + S.BASE.c * CELL + 2, TOP + S.BASE.r * CELL + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = '#fff'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('🏰', x0 + (S.BASE.c + 0.5) * CELL, TOP + (S.BASE.r + 0.5) * CELL + 5);
      ctx.fillText('🌀', x0 + (S.SPAWN.c + 0.5) * CELL, TOP + (S.SPAWN.r + 0.5) * CELL + 5);
      // towers
      for (const t of B.towers) { const o = pmap.get(t[5]); drawTower(x0 + t[1] * CELL, TOP + t[2] * CELL, t[3], t[4], o ? o.color : '#888', t[6] ? 0.35 : 1); }
      // selected
      if (selected && m && m.team === b) {
        const t = towerAt(b, selected.c, selected.r);
        if (t) { rangeCircle(b, t.c, t.r, S.TOWERS[t.type].levels[t.lvl].range, true); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(x0 + t.c * CELL + 1, TOP + t.r * CELL + 1, CELL - 2, CELL - 2); }
      }
      // creeps (interpolated)
      const prev = prevState ? new Map(prevState.boards[b].creeps.map((c) => [c[0], c])) : new Map();
      for (const cr of B.creeps) {
        const p = prev.get(cr[0]);
        let cx = cr[2], cy = cr[3];
        if (p) { cx = p[2] + (cr[2] - p[2]) * alpha; cy = p[3] + (cr[3] - p[3]) * alpha; }
        const px = x0 + cx * CELL, py = TOP + cy * CELL, rad = cr[7] * CELL;
        const col = cr[1] === 'neutral' ? S.NEUTRAL.color : cr[1] === 'boss' ? S.NEUTRAL.bossColor : S.SENDS[cr[1]].color;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        if (cr[6]) { ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 2; ctx.stroke(); }
        const w = Math.max(14, rad * 2);
        ctx.fillStyle = '#300'; ctx.fillRect(px - w / 2, py - rad - 6, w, 3);
        ctx.fillStyle = '#4cd964'; ctx.fillRect(px - w / 2, py - rad - 6, w * Math.max(0, cr[4] / cr[5]), 3);
      }
      // hover
      if (hover && hover.b === b && m) {
        const ht = towerAt(b, hover.c, hover.r);
        if (ht) rangeCircle(b, ht.c, ht.r, S.TOWERS[ht.type].levels[ht.lvl].range, true);
        else if (buildType && b === m.team) {
          const ok = !wouldBlock(b, hover.c, hover.r) && m.gold >= S.TOWERS[buildType].cost;
          rangeCircle(b, hover.c, hover.r, S.TOWERS[buildType].levels[0].range, ok);
          drawTower(x0 + hover.c * CELL, TOP + hover.r * CELL, buildType, 0, ok ? m.color : '#f33', 0.55);
        } else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(x0 + hover.c * CELL + 0.5, TOP + hover.r * CELL + 0.5, CELL - 1, CELL - 1); }
      }
    }
    // effects
    fx = fx.filter((f) => now - f.t0 < f.dur);
    for (const f of fx) {
      const k = (now - f.t0) / f.dur, x0 = BX[f.b];
      if (f.k === 'shot') {
        const col = S.TOWERS[f.tt].color;
        const x1 = x0 + f.x1 * CELL, y1 = TOP + f.y1 * CELL, x2 = x0 + f.x2 * CELL, y2 = TOP + f.y2 * CELL;
        const px = x1 + (x2 - x1) * k, py = y1 + (y2 - y1) * k;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, f.tt === 'cannon' ? 4 : 2.5, 0, 7); ctx.fill();
        if (f.tt === 'frost') { ctx.strokeStyle = 'rgba(111,211,255,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(px, py); ctx.stroke(); }
      } else if (f.k === 'chill') {
        ctx.beginPath(); ctx.arc(x0 + f.x * CELL, TOP + f.y * CELL, f.r * CELL * (0.5 + 0.5 * k), 0, 7);
        ctx.fillStyle = `rgba(111,211,255,${0.25 * (1 - k)})`; ctx.fill();
      } else if (f.k === 'boom') {
        ctx.beginPath(); ctx.arc(x0 + f.x * CELL, TOP + f.y * CELL, f.r * CELL * (0.4 + 0.6 * k), 0, 7);
        ctx.fillStyle = `rgba(255,170,60,${0.45 * (1 - k)})`; ctx.fill();
      }
    }
    // cursors of other players
    for (const p of state.players) {
      if (p.id === you || !p.cursor) continue;
      const x = BX[p.cursor.b] + p.cursor.c * CELL, y = TOP + p.cursor.r * CELL;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y + 4); ctx.lineTo(x + 4, y + 10); ctx.closePath(); ctx.fill();
      ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText(p.name, x + 10, y + 16);
    }
  }
  requestAnimationFrame(render);

  // read-only hooks for the headless smoke test
  window.__ftdState = () => state; window.__ftdWouldBlock = (b, c, r) => wouldBlock(b, c, r);

  // auto-join if room in URL and we have a token (refresh case)
  const urlRoom = params.get('room');
  if (urlRoom && localStorage.getItem('ftd_token_' + urlRoom.toUpperCase())) $('joinBtn').click();
})();
