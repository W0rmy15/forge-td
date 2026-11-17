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
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      if (ev && ev.code === 4001) { replaced(); return; } // seat taken over by another tab: never auto-retry
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
  // leave the room UI and go back to the menu with a message (keeps nothing that would trigger a retry)
  function toMenu(msg, dropToken) {
    const c = rejoinCode || code; stopRetry(); code = null; state = null; prevState = null; lobby = null;
    if (c && dropToken) localStorage.removeItem('ftd_token_' + c);
    if (c) $('codeInput').value = c;
    history.replaceState(null, '', location.pathname);
    show('menu'); $('menuErr').textContent = msg;
  }
  let wasReplaced = false;
  function replaced() {
    if (wasReplaced) return; wasReplaced = true;
    toMenu('This seat was opened in another tab or window. Click Join room to take it back here.', false);
  }
  function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function onMsg(m) {
    if (m.t === 'joined') {
      you = m.you; code = m.code; rejoinCode = null; retries = 0; clearTimeout(retryTimer); wasReplaced = false;
      if (m.rejoined) toast('Reconnected', true);
      localStorage.setItem('ftd_token_' + code, m.token);
      history.replaceState(null, '', '?room=' + code);
    } else if (m.t === 'lobby') { lobby = m; renderLobby(); }
    else if (m.t === 's') {
      // static tower lists are only sent when they change: reuse the last ones we have
      for (const b of ['L', 'R']) if (!m.boards[b].towers) m.boards[b].towers = state && state.boards[b].towers ? state.boards[b].towers : [];
      prevState = state; state = m; stateAt = performance.now(); buildPrev(); trackHits(m); onState(m);
    }
    else if (m.t === 'err') {
      toast(m.msg);
      if (m.code === 'replaced') replaced();
      else if (m.code === 'noroom' || m.code === 'joinfail' || (!code && rejoinCode)) {
        // any join failure (room gone, game in progress, room full): stop retrying and go back to the menu
        toMenu(m.msg, true);
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
      rosterSig = ''; sendSig = '';
      const isHost = lobby.hostId === you;
      $('backBtn').classList.toggle('hidden', !isHost);
      $('overWait').classList.toggle('hidden', isHost);
    }
  }

  // ---------- game UI ----------
  const buildBtns = {}, sendBtns = {}, upBtns = {};
  const AIcon = window.ART, iconCache = {};
  const towerIcon = (k) => iconCache['t' + k] || (iconCache['t' + k] = AIcon.iconURL(AIcon.tower(k, 0), 26));
  const creepIcon = (k, tier) => iconCache['c' + k + tier] || (iconCache['c' + k + tier] = AIcon.iconURL(AIcon.creep(k, tier, k === 'swarm' ? 7 : k === 'brute' ? 9.5 : 8), 26));
  const pips = (t) => '<span class="pips">' + [1, 2, 3].map((i) => `<i class="${i <= t ? 'on' : ''}"></i>`).join('') + '</span>';
  for (const [k, t] of Object.entries(S.TOWERS)) {
    const b = document.createElement('button');
    b.className = 'tbtn t-' + k;
    b.innerHTML = `<img src="${towerIcon(k)}" alt=""><span class="nm"><span class="k">${t.key}</span> ${t.name}</span><span class="cost">${t.cost}g</span>`; b.title = t.desc;
    b.onclick = () => { buildType = buildType === k ? null : k; selected = null; };
    $('buildBtns').appendChild(b); buildBtns[k] = b;
  }
  const rampFull = S.sendRampFullWave();
  function sendTitle(k, tier) {
    const t = S.SENDS[k], sp = S.sendSpec(k, tier);
    return `${t.desc}: ${sp.count}× ${Math.round(t.hpMult * S.SEND_UP.HP[tier] * 100)}% of a wave creep's HP (more in 2v2; weaker early, full strength from wave ${rampFull}). ` +
      `Kill bounty ${sp.bounty}g for the defender. Income gain shrinks as your send income grows.` + (tier ? ` Tier ${tier}: ${S.SEND_TRAITS[k].desc[tier]}.` : '');
  }
  for (const [k, t] of Object.entries(S.SENDS)) {
    const col = document.createElement('div'); col.className = 'scol';
    const b = document.createElement('button'); b.className = 'sbtn s-' + k;
    b.onclick = () => sendMsg({ t: 'send', kind: k });
    const u = document.createElement('button'); u.className = 'ubtn';
    u.onclick = () => sendMsg({ t: 'sendup', kind: k });
    col.appendChild(b); col.appendChild(u); $('sendBtns').appendChild(col); sendBtns[k] = b; upBtns[k] = u;
  }
  let sendSig = '';
  function renderSendBtns(m, wave) {
    const tiers = m.tiers || {};
    const sig = JSON.stringify([tiers, m.gold, wave]);
    if (sig === sendSig) return; sendSig = sig;
    for (const [k, t] of Object.entries(S.SENDS)) {
      const tier = tiers[k] || 0, sp = S.sendSpec(k, tier), up = S.sendUpCost(k, tier), unlock = up !== null ? S.SEND_UP.UNLOCK_WAVE[tier + 1] : 0;
      const html = `<img src="${creepIcon(k, tier)}" alt=""><span class="nm"><span class="k">${t.key.toUpperCase()}</span> ${t.name}</span><span class="cost">${sp.cost}g <small>+${Math.round(sp.income * 10) / 10}</small></span>${pips(tier)}`;
      if (sendBtns[k].dataset.html !== html) { sendBtns[k].innerHTML = html; sendBtns[k].dataset.html = html; sendBtns[k].title = sendTitle(k, tier); }
      sendBtns[k].disabled = m.gold < sp.cost;
      const uh = up === null ? '★ MAX' : wave < unlock ? `🔒 T${tier + 1} @ wave ${unlock}` : `⬆ T${tier + 1} · ${up}g`;
      if (upBtns[k].dataset.html !== uh) { upBtns[k].innerHTML = uh; upBtns[k].dataset.html = uh; }
      upBtns[k].title = up === null ? `${t.name} is max tier` : `[Shift+${t.key.toUpperCase()}] Upgrade ${t.name} to tier ${tier + 1}: ${S.SEND_TRAITS[k].desc[tier + 1]}, HP ×${S.SEND_UP.HP[tier + 1]} (price ×${S.SEND_UP.COST[tier + 1]}). Lasts the whole match. Unlocks at wave ${unlock}.`;
      upBtns[k].disabled = up === null || wave < unlock || m.gold < up;
      upBtns[k].classList.toggle('max', up === null);
    }
  }
  function tierBadges(p) {
    const t = p.tiers || {};
    return '<span class="tiers">' + Object.keys(S.SENDS).map((k) => `<span class="tb" title="${S.SENDS[k].name} tier ${t[k] || 0}${t[k] ? ': ' + S.SEND_TRAITS[k].desc[t[k]] : ''}"><img src="${creepIcon(k, t[k] || 0)}" alt="">${t[k] ? '<b>' + t[k] + '</b>' : ''}</span>`).join('') + '</span>';
  }

  function me() { return state && state.players.find((p) => p.id === you); }

  function onState(s) {
    const m = me();
    if (!m) return;
    $('gold').textContent = m.gold; $('income').textContent = m.income;
    $('nextIncome').textContent = Math.ceil(s.nextIncome) + 's';
    $('wave').textContent = s.wave; $('nextWave').textContent = Math.ceil(s.nextWave) + 's';
    for (const [k, t] of Object.entries(S.TOWERS)) { buildBtns[k].classList.toggle('active', buildType === k); buildBtns[k].disabled = m.gold < t.cost; }
    renderSendBtns(m, s.wave);
    const enemy = m.team === 'L' ? 'R' : 'L';
    $('sendsQueued').textContent = s.boards[enemy].queuedSends || 0;
    $('sendsOnMe').textContent = s.boards[m.team].queuedSends || 0;
    // roster: only touch the DOM when something visible changed
    const sig = JSON.stringify([s.boards.L.lives, s.boards.R.lives, s.players.map((p) => [p.id, p.name, p.team, p.connected, p.gold, p.income, p.tiers])]);
    if (sig !== rosterSig) {
      rosterSig = sig;
      $('roster').innerHTML = ['L', 'R'].map((t) =>
        `<div class="rteam" style="color:${TEAMCOL[t]}"><b>${t === 'L' ? 'Left' : 'Right'}</b> <span class="lv">❤ ${s.boards[t].lives}</span></div>` +
        s.players.filter((p) => p.team === t).map((p) =>
          `<div class="rp"><span class="dot" style="background:${p.color}"></span><span class="rn">${esc(p.name)}${p.id === you ? ' (you)' : ''}${p.connected ? '' : ' (offline)'}</span> <span class="rg">${p.gold !== undefined ? `${p.gold}g · ` : ''}+${p.income}</span>${tierBadges(p)}</div>`).join('')).join('');
      // enemy send tiers, front and centre for the defender
      const foes = s.players.filter((p) => p.team !== m.team);
      $('enemyTiers').innerHTML = foes.map((p) => `<div class="et"><span class="dot" style="background:${p.color}"></span><span class="rn">${esc(p.name)}</span>${tierBadges(p)}</div>`).join('');
    }
    // selection panel
    renderSel();
    renderBanner(s, m);
    // effects from events
    for (const e of s.ev) {
      if (e.k === 'shot' || e.k === 'boom' || e.k === 'chill' || e.k === 'kill') fxEvent(e);
      else if (e.k === 'leak') fxEvent(e);
      else if (e.k === 'sendup') {
        const nm = S.SENDS[e.kind].name, tr = S.SEND_TRAITS[e.kind].desc[e.tier];
        if (e.id === you) { toast(`${nm} upgraded to tier ${e.tier}: ${tr}`, true, 'myup'); flashBtn(upBtns[e.kind]); }
        else if (e.team === m.team) toast(`${e.name} upgraded ${nm} to tier ${e.tier}`, true, 'teamup');
        else toast(`⚠ ${e.name} upgraded ${nm} to tier ${e.tier}: ${tr}`, false, 'enemyup' + e.kind);
      }
      else if (e.k === 'sudden') toast(`SUDDEN DEATH: every wave now gets ×${S.WAVE.SUDDEN_DEATH_GROWTH} more HP!`, false, 'sudden');
      else if (e.k === 'finishing') toast(e.fell === 'both' ? 'Both bases fell! Finishing the wave…' : e.fell === m.team ? 'Your base fell! Finishing the wave: fewer total lives lost still wins' : 'Enemy base fell! Finishing the wave…', false, 'fin');
      else if (e.k === 'send' && e.id === you) { toast(`Sent ${e.tier ? 'T' + e.tier + ' ' : ''}${S.SENDS[e.kind].name}${S.sendSpec(e.kind, e.tier).count > 1 ? ' ×' + S.sendSpec(e.kind, e.tier).count : ''} (${e.n} sent this game)`, true, 'mysend'); flashBtn(sendBtns[e.kind]); }
      else if (e.k === 'send' && e.team === m.team) toast(`${e.name} sent ${S.SENDS[e.kind].name}`, true, 'teamsend');
      else if (e.k === 'wave') toast(e.boss ? `Wave ${e.n}: BOSS incoming!` : `Wave ${e.n} incoming`, true);
      else if (e.k === 'send' && e.team !== m.team) enemySendToast(e);
    }
    if (s.phase === 'over' || s.winner) {
      $('over').classList.remove('hidden');
      $('overText').textContent = s.winner === 'draw' ? 'Draw!' : s.winner === m.team ? '🏆 Victory!' : '💀 Defeat';
      $('overReason').textContent = s.winReason || '';
      $('overStats').innerHTML = s.players.map((p) => `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)} (${p.team}) — kills ${p.kills}, sent ${p.sent}, income ${p.income}</div>`).join('');
    } else $('over').classList.add('hidden');
  }

  // enemy sends are tallied into one toast while it is queued or showing, so they never push other toasts out
  let enemyTally = {};
  function enemySendToast(e) {
    if (!toastHas('esend')) enemyTally = {};
    const key = e.kind + '|' + (e.tier || 0);
    enemyTally[key] = (enemyTally[key] || 0) + S.sendSpec(e.kind, e.tier).count;
    toast('Incoming enemy sends: ' + Object.entries(enemyTally).map(([k, n]) => { const [kind, t] = k.split('|'); return `${n}× ${+t ? 'T' + t + ' ' : ''}${S.SENDS[kind].name}`; }).join(', '), false, 'esend');
  }
  // permanent HUD banner for sudden death / the final wave
  function renderBanner(s, m) {
    const el = $('sdBanner'); let txt = '', cls = '';
    if (s.fin) {
      txt = s.fin.fell === 'both' ? '⚖️ Both bases fell — finishing the wave. Fewer total lives lost wins.'
        : `⚖️ ${s.fin.fell === m.team ? 'Your' : 'The enemy'} base fell — finishing wave ${s.fin.wave}. Fewer total lives lost (overkill counts) wins.`;
      cls = 'fin';
    } else if (s.sd) txt = `☠️ SUDDEN DEATH — each wave gets ×${S.WAVE.SUDDEN_DEATH_GROWTH} extra HP. If a base falls, the wave is finished and fewer lives lost wins.`;
    else if (s.wave >= S.WAVE.SUDDEN_DEATH_WAVE - 3) { txt = `Sudden death starts at wave ${S.WAVE.SUDDEN_DEATH_WAVE}`; cls = 'soon'; }
    if (el.dataset.txt !== txt) { el.dataset.txt = txt; el.textContent = txt; el.className = 'banner' + (cls ? ' ' + cls : '') + (txt ? '' : ' hidden'); }
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
    const busy = !!state.boards[m.team].busy; // server's rule: creeps on the board or a spawn due
    const html = `<b>${spec.name}</b> Lv ${t.lvl + 1}/3 ${mine ? '' : `<small>(${esc(owner ? owner.name : '?')}'s)</small>`}<br>
      <small>Dmg ${st.dmg}${nx ? '→' + nx.dmg : ''} · Range ${st.range}${st.splash ? ' · Splash ' + st.splash : ''}${st.slow ? ' · Slow ' + Math.round(st.slow * 100) + '% (area ' + st.area + ')' : ''}</small>
      ${!mine ? (t.selling ? '<div class="row"><small>Sale queued</small></div>' : '')
        : t.selling ? `<div class="row"><small class="queued">💲 Sale queued (${sell}g) — sells when your board is clear</small></div><div class="row"><button id="sellBtn">[X] Cancel sale</button></div>`
        : `<div class="row"><button id="upBtn" ${up === null || m.gold < up ? 'disabled' : ''}>[U] Upgrade ${up === null ? 'MAX' : up + 'g'}</button><button id="sellBtn" class="${armed ? 'danger' : ''}">${armed ? 'Confirm sell?' : `[X] Sell ${sell}g`}</button></div>${busy ? '<small class="hint">Creeps on board or a spawn is due: the sale is queued until your board is clear (the tower keeps firing)</small>' : ''}`}`;
    if (el.dataset.html !== html) {
      el.innerHTML = html; el.dataset.html = html;
      if ($('upBtn')) $('upBtn').onclick = doUpgrade; if ($('sellBtn')) $('sellBtn').onclick = doSell;
    }
    el.classList.remove('hidden');
  }
  function doUpgrade() { if (selected) sendMsg({ t: 'upgrade', c: selected.c, r: selected.r }); }
  // two-step sell: first press arms, second press within 2.5 s confirms. On a queued sale one press cancels it.
  function doSell() {
    if (!selected) return;
    const m = me(), t = m && towerAt(m.team, selected.c, selected.r);
    if (t && t.selling) { if (t.owner === you) { sendMsg({ t: 'sell', c: t.c, r: t.r }); toast('Sale cancelled', true); } return; }
    const now = performance.now();
    if (sellArm && sellArm.c === selected.c && sellArm.r === selected.r && now < sellArm.until) {
      const busy = state && m && state.boards[m.team].busy;
      sendMsg({ t: 'sell', c: selected.c, r: selected.r }); sellArm = null;
      if (busy) toast('Sale queued: it executes when your board is clear', true); else selected = null;
    } else { sellArm = { c: selected.c, r: selected.r, until: now + 2500 }; toast('Press X / Sell again to confirm', true); setTimeout(renderSel, 2600); }
    renderSel();
  }

  // ---------- input ----------
  const cv = $('cv'), ctx = cv.getContext('2d');
  function cellFromEvent(e) {
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (760 / rect.width), y = (e.clientY - rect.top) * (660 / rect.height);
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
    if (buildType) sendMsg({ t: 'build', type: buildType, c: h.c, r: h.r });
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
    if (e.repeat && (k === 'u' || k === 'x' || k === 'delete' || Object.values(S.SENDS).some((t) => t.key === k))) return; // held keys: no auto-repeat
    for (const [id, t] of Object.entries(S.SENDS)) if (k === t.key) sendMsg(e.shiftKey ? { t: 'sendup', kind: id } : { t: 'send', kind: id });
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

  // toast queue: messages are shown one after another instead of overwriting each other.
  // A toast with a key replaces a queued (or showing) toast with the same key, so bursts (e.g. enemy sends) coalesce.
  const toastQ = []; let toastCur = null, toastTimer = null;
  function toast(msg, info, key) {
    const item = { msg, info: !!info, key: key || null };
    if (key) {
      if (toastCur && toastCur.key === key) { toastCur.msg = msg; paintToast(); return; }
      const i = toastQ.findIndex((x) => x.key === key); if (i >= 0) { toastQ[i] = item; return; }
    }
    if (toastQ.length >= 4) { const i = toastQ.findIndex((x) => x.info); toastQ.splice(i >= 0 ? i : 0, 1); } // keep it short
    toastQ.push(item);
    if (!toastCur) nextToast();
  }
  function toastHas(key) { return (toastCur && toastCur.key === key) || toastQ.some((x) => x.key === key); }
  function paintToast() { const t = $('toast'); t.textContent = toastCur.msg; t.className = 'show' + (toastCur.info ? ' info' : ''); }
  function nextToast() {
    clearTimeout(toastTimer);
    toastCur = toastQ.shift() || null;
    if (!toastCur) { $('toast').className = ''; return; }
    paintToast();
    toastTimer = setTimeout(nextToast, toastQ.length ? 1100 : 1800);
  }
  window.__ftdToasts = () => ({ cur: toastCur && toastCur.msg, queued: toastQ.map((x) => x.msg) }); // read-only hook for the smoke test

  // ---------- rendering ----------
  // Static layers (grass, dirt trail along the current route, frame, portal, castle, tower pads) are cached per board
  // in an offscreen canvas and only redrawn when that board's tower list changes. Per-frame work is drawImage of
  // cached sprites plus a fixed-size particle pool (no per-frame allocations in the hot loops).
  const AR = window.ART;
  const W = 760, H = 660, BW = S.COLS * CELL, BH = S.ROWS * CELL, PADX = 12;
  let dpr = 1;
  function setupCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    for (const b of ['L', 'R']) boardCache[b].ref = null;
  }
  const boardCache = { L: { cv: document.createElement('canvas'), ref: null, d: null }, R: { cv: document.createElement('canvas'), ref: null, d: null } };
  function dists() { // distance fields follow the tower lists (same array object until the server sends a new one)
    for (const b of ['L', 'R']) {
      const bc = boardCache[b], tw = state.boards[b].towers;
      if (bc.dref !== tw) { bc.dref = tw; const set = new Set(tw.map((t) => t[1] + ',' + t[2])); bc.d = S.computeDist((c, r) => set.has(c + ',' + r)); }
    }
    return { L: boardCache.L.d, R: boardCache.R.d };
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
  function routePts(d, x0) {
    const pts = [[x0 + (S.SPAWN.c + 0.5) * CELL, (S.SPAWN.r + 0.5) * CELL]];
    let pc = S.SPAWN.c, pr = S.SPAWN.r, guard = 0;
    while (guard++ < 400) { const n = S.nextCell(d, pc, pr); if (!n) break; pts.push([x0 + (n.c + 0.5) * CELL, (n.r + 0.5) * CELL]); pc = n.c; pr = n.r; }
    return pts;
  }
  function ensureBoard(b, pmap) {
    const bc = boardCache[b], B = state.boards[b];
    if (bc.ref === B.towers && bc.dpr === dpr) return bc.cv;
    bc.ref = B.towers; bc.dpr = dpr;
    const w = BW + PADX * 2, h = BH + PADX * 2;
    bc.cv.width = w * dpr; bc.cv.height = h * dpr;
    const g = bc.cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    AR.drawFrame(g, PADX, PADX, BW, BH);
    g.save(); g.translate(PADX, PADX); AR.rrect(g, 0, 0, BW, BH, 6); g.clip();
    AR.drawGrass(g, BW, BH, CELL, b === 'L' ? 11 : 23);
    AR.drawPath(g, routePts(dists()[b], 0), CELL);
    AR.drawPortal(g, (S.SPAWN.c + 0.5) * CELL, (S.SPAWN.r + 0.5) * CELL, CELL);
    AR.drawCastle(g, (S.BASE.c + 0.5) * CELL, (S.BASE.r + 0.5) * CELL, CELL, TEAMCOL[b]);
    for (const t of B.towers) { const o = pmap.get(t[5]); const p = AR.pad(o ? o.color : '#999', t[4], CELL); g.drawImage(p.c, (t[1] + 0.5) * CELL - p.w / 2, (t[2] + 0.5) * CELL - p.h / 2 + 1, p.w, p.h); }
    g.restore();
    return bc.cv;
  }

  // ---- particle / effect pool ----
  const POOL = 900, P = [];
  for (let i = 0; i < POOL; i++) P.push({ on: false, t: 0, x: 0, y: 0, vx: 0, vy: 0, x2: 0, y2: 0, t0: 0, dur: 0, s: 0, col: '', rot: 0, vr: 0, txt: '', a: 0 });
  let pNext = 0;
  function spawnP(t, x, y, dur) {
    for (let k = 0; k < POOL; k++) {
      const p = P[pNext]; pNext = (pNext + 1) % POOL;
      if (!p.on) { p.on = true; p.t = t; p.x = x; p.y = y; p.t0 = performance.now(); p.dur = dur; p.vx = 0; p.vy = 0; p.rot = 0; p.vr = 0; p.s = 1; p.a = 0; p.soft = 0; return p; }
    }
    return null; // pool full: drop the effect
  }
  const CHILL = new Map();
  const TWR = new Map(); // tower anim state by numeric key: { ang, kick }
  const twKey = (b, c, r) => (b === 'L' ? 0 : 10000) + r * 100 + c;
  function bx(b, x) { return BX[b] + x * CELL; } function by(y) { return TOP + y * CELL; }
  function fxEvent(e) {
    const now = performance.now();
    if (e.k === 'shot') {
      const k = twKey(e.b, Math.floor(e.x1), Math.floor(e.y1));
      let a = TWR.get(k); if (!a) { a = { ang: 0, kick: 0 }; TWR.set(k, a); }
      a.ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1) + Math.PI / 2; a.kick = now;
      const p = spawnP('proj', bx(e.b, e.x1), by(e.y1), e.tt === 'cannon' ? 230 : e.tt === 'frost' ? 170 : 110);
      if (p) { p.x2 = bx(e.b, e.x2); p.y2 = by(e.y2); p.txt = e.tt; p.rot = Math.atan2(p.y2 - p.y, p.x2 - p.x); }
      if (e.tt === 'cannon') { const m = spawnP('muzzle', bx(e.b, e.x1) + Math.sin(a.ang) * 16, by(e.y1) - Math.cos(a.ang) * 16, 110); if (m) m.rot = a.ang; }
    } else if (e.k === 'boom') {
      const x = bx(e.b, e.x), y = by(e.y), r = e.r * CELL;
      const ring = spawnP('ring', x, y, 260); if (ring) { ring.s = r; ring.col = '255,190,60'; }
      for (let i = 0; i < 5; i++) { const p = spawnP('puff', x + (Math.random() - 0.5) * r * 0.8, y + (Math.random() - 0.5) * r * 0.8, 380 + Math.random() * 200); if (p) { p.s = 5 + Math.random() * 6; p.col = i < 2 ? '255,210,90' : '240,240,240'; p.vy = -0.012; } }
      const f = spawnP('pop', x, y, 160); if (f) { f.s = r * 0.7; f.col = '#ffcf33'; }
    } else if (e.k === 'chill') {
      const x = bx(e.b, e.x), y = by(e.y), r = e.r * CELL;
      const ck = twKey(e.b, Math.floor(e.x), Math.floor(e.y)) + 50000; // throttle: one frost ring per tower per 700 ms keeps busy boards readable
      if (now - (CHILL.get(ck) || 0) < 700) return; CHILL.set(ck, now);
      const ring = spawnP('ring', x, y, 320); if (ring) { ring.s = r; ring.col = '140,225,255'; ring.soft = 1; }
      for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, p = spawnP('flake', x, y, 420); if (p) { p.vx = Math.cos(a) * r * 0.003; p.vy = Math.sin(a) * r * 0.003; p.vr = (Math.random() - 0.5) * 0.01; p.s = 2.5 + Math.random() * 1.5; } }
    } else if (e.k === 'kill') {
      const x = bx(e.b, e.x), y = by(e.y), col = AR.creepColor(e.kind, e.v), big = e.kind === 'boss' || e.kind === 'brute';
      const f = spawnP('pop', x, y, 170); if (f) { f.s = big ? 16 : 10; f.col = '#ffffff'; }
      const n = big ? 12 : e.kind === 'swarm' ? 5 : 8;
      for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + Math.random() * 0.5, sp = 0.05 + Math.random() * 0.07; const p = spawnP('conf', x, y, 420 + Math.random() * 250); if (p) { p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 0.03; p.col = i % 3 === 0 ? '#ffffff' : col; p.s = 1.8 + Math.random() * 2; p.vr = (Math.random() - 0.5) * 0.03; } }
      if (e.o === you) { const t = spawnP('text', x, y - 6, 900); if (t) { t.txt = '+' + e.g; t.col = '#ffd23a'; t.s = e.g >= 10 ? 15 : 12; } }
    } else if (e.k === 'leak') {
      const t = spawnP('text', bx(e.team, S.BASE.c + 0.5), by(S.BASE.r) - 4, 1000); if (t) { t.txt = '-' + e.n + ' ♥'; t.col = '#ff4d6d'; t.s = 15; }
    }
  }
  function drawP(now) {
    for (let i = 0; i < POOL; i++) {
      const p = P[i]; if (!p.on) continue;
      const age = now - p.t0, k = age / p.dur;
      if (k >= 1) { p.on = false; continue; }
      if (p.t === 'proj') {
        const x = p.x + (p.x2 - p.x) * k, y = p.y + (p.y2 - p.y) * k;
        if (p.txt === 'cannon') {
          const lift = Math.sin(k * Math.PI) * 9, sc = 1 + Math.sin(k * Math.PI) * 0.35, sp = AR.ball();
          for (let j = 1; j <= 3; j++) { const kk = Math.max(0, k - j * 0.08); ctx.globalAlpha = 0.35 - j * 0.09; ctx.fillStyle = '#eeeeee'; ctx.beginPath(); ctx.arc(p.x + (p.x2 - p.x) * kk, p.y + (p.y2 - p.y) * kk - Math.sin(kk * Math.PI) * 9, 3 + j, 0, 6.283); ctx.fill(); }
          ctx.globalAlpha = 1; ctx.drawImage(sp.c, x - sp.w * sc / 2, y - lift - sp.h * sc / 2, sp.w * sc, sp.h * sc);
        } else {
          const sp = p.txt === 'frost' ? AR.shard() : AR.dart(false), tx = p.x + (p.x2 - p.x) * Math.max(0, k - 0.35), ty = p.y + (p.y2 - p.y) * Math.max(0, k - 0.35);
          ctx.strokeStyle = p.txt === 'frost' ? 'rgba(170,235,255,0.75)' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.restore();
        }
      } else if (p.t === 'conf') {
        const x = p.x + p.vx * age, y = p.y + p.vy * age + 0.00012 * age * age;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = p.col; ctx.save(); ctx.translate(x, y); ctx.rotate(p.vr * age); ctx.fillRect(-p.s, -p.s * 0.6, p.s * 2, p.s * 1.2); ctx.restore(); ctx.globalAlpha = 1;
      } else if (p.t === 'pop') {
        const r = p.s * (0.5 + 0.7 * k);
        ctx.globalAlpha = 1 - k; AR.star(ctx, p.x, p.y, r, 8, 0.55); ctx.fillStyle = p.col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = AR.OUT; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.t === 'ring') {
        ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = `rgba(${p.col},1)`; ctx.lineWidth = 3.5 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.35 + 0.75 * k), 0, 6.283); ctx.stroke();
        ctx.fillStyle = `rgba(${p.col},${(p.soft ? 0.1 : 0.22) * (1 - k)})`; ctx.fill(); ctx.globalAlpha = 1;
      } else if (p.t === 'puff') {
        ctx.fillStyle = `rgba(${p.col},${0.75 * (1 - k)})`; ctx.beginPath(); ctx.arc(p.x, p.y + p.vy * age, p.s * (0.6 + k), 0, 6.283); ctx.fill();
      } else if (p.t === 'flake') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffffff'; AR.star(ctx, p.x + p.vx * age, p.y + p.vy * age, p.s, 6, 0.4); ctx.fill(); ctx.globalAlpha = 1;
      } else if (p.t === 'muzzle') {
        ctx.globalAlpha = 1 - k; AR.star(ctx, p.x, p.y, 7 * (1 - k * 0.5), 7, 0.45); ctx.fillStyle = '#ffe14a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff8a1f'; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.t === 'text') {
        const y = p.y - 26 * k, sc = k < 0.15 ? 0.6 + k * 2.7 : 1;
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1; ctx.font = `700 ${Math.round(p.s * sc)}px ${FONT}`; ctx.textAlign = 'center';
        ctx.lineWidth = 3.5; ctx.strokeStyle = AR.OUT; ctx.strokeText(p.txt, p.x, y); ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, y); ctx.globalAlpha = 1;
      }
    }
  }
  window.__ftdFx = () => { let n = 0; for (const p of P) if (p.on) n++; return n; }; // read-only hook (tests)

  const FONT = "Fredoka, 'Baloo 2', 'Comic Sans MS', 'Trebuchet MS', system-ui, sans-serif";
  const DASH = [6, 5], NODASH = [];
  function rangeCircle(b, c, r, range, ok) {
    const x = BX[b] + (c + 0.5) * CELL, y = TOP + (r + 0.5) * CELL;
    ctx.beginPath(); ctx.arc(x, y, range * CELL, 0, Math.PI * 2);
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.2)' : 'rgba(255,60,60,0.2)'; ctx.fill();
    ctx.setLineDash(DASH); ctx.lineDashOffset = -performance.now() / 60;
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.95)' : 'rgba(255,70,70,0.95)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash(NODASH);
  }
  function drawTowerSprite(x, y, type, lvl, ang, kick, alpha, now) {
    const sp = AR.tower(type, lvl);
    const kt = now - kick, recoil = kt < 140 ? (1 - kt / 140) * 3.5 : 0;
    const sq = type === 'frost' && kt < 180 ? 1 + Math.sin((kt / 180) * Math.PI) * 0.12 : 1;
    ctx.globalAlpha = alpha;
    if (AR.rotates(type)) { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2 + recoil, sp.w, sp.h); ctx.restore(); }
    else {
      if (type === 'frost' && lvl === 2) { ctx.fillStyle = `rgba(140,225,255,${0.18 + 0.1 * Math.sin(now / 300)})`; ctx.beginPath(); ctx.arc(x, y, 15, 0, 6.283); ctx.fill(); }
      ctx.drawImage(sp.c, x - (sp.w * sq) / 2, y - (sp.h / sq) / 2 - 2 + (sp.h - sp.h / sq) / 2, sp.w * sq, sp.h / sq);
    }
    ctx.globalAlpha = 1;
  }
  function headerText(txt, x, y, col, align, size) {
    ctx.font = `700 ${size || 16}px ${FONT}`; ctx.textAlign = align; ctx.lineWidth = 4; ctx.strokeStyle = AR.OUT; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y);
  }
  const hpSeen = new Map(); // creep id -> { hp, hit (time of last damage), gen }
  let hpGen = 0;
  function trackHits(s) { // hit flashes: a creep whose HP dropped since the last snapshot flashes white
    hpGen++; const now = performance.now();
    for (const b of ['L', 'R']) for (const cr of s.boards[b].creeps) {
      const h = hpSeen.get(cr[0]);
      if (!h) hpSeen.set(cr[0], { hp: cr[4], hit: 0, gen: hpGen });
      else { if (cr[4] < h.hp) h.hit = now; h.hp = cr[4]; h.gen = hpGen; }
    }
    if (hpGen % 40 === 0) for (const [id, h] of hpSeen) if (h.gen !== hpGen) hpSeen.delete(id);
  }
  const prevMaps = { L: new Map(), R: new Map() };
  function buildPrev() { for (const b of ['L', 'R']) { const m = prevMaps[b]; m.clear(); if (prevState) for (const c of prevState.boards[b].creeps) m.set(c[0], c); } }
  let bgGrad = null, frameStats = { n: 0, total: 0, max: 0 };
  window.__ftdFrameStats = () => ({ frames: frameStats.n, avgMs: frameStats.n ? +(frameStats.total / frameStats.n).toFixed(3) : 0, maxMs: +frameStats.max.toFixed(3) }); // read-only perf hook
  window.__ftdResetFrameStats = () => { frameStats = { n: 0, total: 0, max: 0 }; };

  function render() {
    requestAnimationFrame(render);
    if (!state) return;
    const t0 = performance.now(), now = t0;
    const alpha = Math.min(1, (now - stateAt) / 50);
    const m = me();
    const pmap = new Map(state.players.map((p) => [p.id, p]));
    const d = dists();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bgGrad) { bgGrad = ctx.createLinearGradient(0, 0, 0, H); bgGrad.addColorStop(0, '#5fc1f5'); bgGrad.addColorStop(0.6, '#8fdcff'); bgGrad.addColorStop(1, '#b6ec8d'); }
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
    for (const b of ['L', 'R']) {
      const B = state.boards[b], x0 = BX[b];
      // header
      headerText(`${b === 'L' ? 'LEFT' : 'RIGHT'}${m && m.team === b ? ' · you' : ''}`, x0, 22, TEAMCOL[b], 'left', 17);
      const hs = AR.heart(); ctx.drawImage(hs.c, x0 + BW - 56, 8, hs.w, hs.h);
      headerText(String(B.lives), x0 + BW, 22, B.leak ? '#ff6b6b' : '#ffffff', 'right', 18);
      ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#1d3b52';
      ctx.fillText(state.players.filter((p) => p.team === b).map((p) => p.name).join(' & '), x0, 34);
      // cached static board
      const bcv = ensureBoard(b, pmap);
      ctx.drawImage(bcv, x0 - PADX, TOP - PADX, BW + PADX * 2, BH + PADX * 2);
      if (B.leak) { ctx.fillStyle = 'rgba(255,40,60,0.22)'; ctx.fillRect(x0, TOP, BW, BH); }
      // portal swirl
      { const px = x0 + (S.SPAWN.c + 0.5) * CELL, py = TOP + (S.SPAWN.r + 0.5) * CELL; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { const a = now / 300 + i * 2.094; ctx.beginPath(); ctx.arc(px, py, 8, a, a + 1.3); ctx.stroke(); } }
      // towers
      for (const t of B.towers) {
        const a = TWR.get(twKey(b, t[1], t[2]));
        drawTowerSprite(x0 + (t[1] + 0.5) * CELL, TOP + (t[2] + 0.5) * CELL, t[3], t[4], a ? a.ang : 0, a ? a.kick : -1e9, t[6] ? 0.55 : 1, now);
        if (t[6]) { const c = AR.coin(), bob = Math.sin(now / 200 + t[0]) * 1.5; ctx.drawImage(c.c, x0 + (t[1] + 1) * CELL - 12, TOP + t[2] * CELL - 3 + bob, c.w, c.h); } // sale queued
      }
      // selected
      if (selected && m && m.team === b) {
        const t = towerAt(b, selected.c, selected.r);
        if (t) { rangeCircle(b, t.c, t.r, S.TOWERS[t.type].levels[t.lvl].range, true); ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x0 + (t.c + 0.5) * CELL, TOP + (t.r + 0.5) * CELL, CELL * 0.55 + Math.sin(now / 150) * 1.5, 0, 6.283); ctx.stroke(); }
      }
      // creeps (interpolated): shadows, bodies, then health bars
      const prev = prevMaps[b], creeps = B.creeps;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < creeps.length; i++) {
          const cr = creeps[i], p = prev.get(cr[0]);
          let cx = cr[2], cy = cr[3];
          if (p) { cx = p[2] + (cr[2] - p[2]) * alpha; cy = p[3] + (cr[3] - p[3]) * alpha; }
          const kind = cr[1], R = AR.creepR(kind, cr[7], CELL), px = x0 + cx * CELL, py = TOP + cy * CELL;
          if (pass === 0) { const sh = AR.shadow(R); ctx.drawImage(sh.c, px - sh.w / 2, py + R * 0.55 - sh.h / 2, sh.w, sh.h); continue; }
          const ph = now * (kind === 'runner' ? 0.02 : kind === 'brute' || kind === 'boss' ? 0.008 : 0.013) + cr[0] * 1.7;
          const bounce = Math.abs(Math.sin(ph)), lift = bounce * R * 0.28, sq = 1 + (1 - bounce) * 0.1;
          if (pass === 1) {
            const sp = AR.creep(kind, cr[8], R), w = sp.w * sq, h = sp.h / sq;
            ctx.drawImage(sp.c, px - w / 2, py - lift - h / 2 + (sp.h - h) * 0.3, w, h);
            const hs = hpSeen.get(cr[0]);
            if (hs && now - hs.hit < 90) { const f = AR.creepFlash(R); ctx.globalAlpha = 0.7 * (1 - (now - hs.hit) / 90); ctx.drawImage(f.c, px - f.w / 2, py - lift - f.h / 2, f.w, f.h); ctx.globalAlpha = 1; }
            if (cr[6]) { const ic = AR.creepIce(R); ctx.drawImage(ic.c, px - ic.w / 2, py - lift - ic.h / 2, ic.w, ic.h); }
          } else if (cr[4] < cr[5]) {
            const w = Math.max(16, R * 2.1), y = py - lift - R - 8, f = Math.max(0, cr[4] / cr[5]);
            ctx.fillStyle = AR.OUT; ctx.fillRect(px - w / 2 - 1.5, y - 1.5, w + 3, 6);
            ctx.fillStyle = '#5a1a2a'; ctx.fillRect(px - w / 2, y, w, 3);
            ctx.fillStyle = f > 0.5 ? '#4ce06a' : f > 0.25 ? '#ffd23a' : '#ff4d4d'; ctx.fillRect(px - w / 2, y, w * f, 3);
          }
        }
      }
      // hover / ghost placement
      if (hover && hover.b === b && m) {
        const ht = towerAt(b, hover.c, hover.r), hx = x0 + (hover.c + 0.5) * CELL, hy = TOP + (hover.r + 0.5) * CELL;
        if (ht) rangeCircle(b, ht.c, ht.r, S.TOWERS[ht.type].levels[ht.lvl].range, true);
        else if (buildType && b === m.team) {
          const ok = !wouldBlock(b, hover.c, hover.r) && m.gold >= S.TOWERS[buildType].cost;
          rangeCircle(b, hover.c, hover.r, S.TOWERS[buildType].levels[0].range, ok);
          const pd = AR.pad(ok ? m.color : '#ff4d4d', 0, CELL); ctx.globalAlpha = 0.75; ctx.drawImage(pd.c, hx - pd.w / 2, hy - pd.h / 2 + 1, pd.w, pd.h);
          drawTowerSprite(hx, hy, buildType, 0, 0, -1e9, ok ? 0.75 : 0.45, now);
          if (!ok) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hx - 8, hy - 8); ctx.lineTo(hx + 8, hy + 8); ctx.moveTo(hx + 8, hy - 8); ctx.lineTo(hx - 8, hy + 8); ctx.stroke(); }
        } else { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; AR.rrect(ctx, x0 + hover.c * CELL + 2, TOP + hover.r * CELL + 2, CELL - 4, CELL - 4, 6); ctx.stroke(); }
      }
    }
    drawP(now);
    // cursors of other players
    for (const p of state.players) {
      if (p.id === you || !p.cursor) continue;
      const x = BX[p.cursor.b] + p.cursor.c * CELL, y = TOP + p.cursor.r * CELL;
      ctx.fillStyle = p.color; ctx.strokeStyle = AR.OUT; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 11, y + 5); ctx.lineTo(x + 5, y + 11); ctx.closePath(); ctx.fill(); ctx.stroke();
      headerText(p.name, x + 10, y + 21, p.color, 'left', 11);
    }
    const dt = performance.now() - t0; frameStats.n++; frameStats.total += dt; if (dt > frameStats.max) frameStats.max = dt;
  }
  setupCanvas();
  window.addEventListener('resize', () => { if (Math.min(2, window.devicePixelRatio || 1) !== dpr) setupCanvas(); });
  requestAnimationFrame(render);

  // ---------- menu art: a little animated scene drawn with the game's own sprites ----------
  (function menuArt() {
    const mc = $('menuArt'); if (!mc) return;
    const MW = 460, MH = 150, md = Math.min(2, window.devicePixelRatio || 1);
    mc.width = MW * md; mc.height = MH * md; const g = mc.getContext('2d');
    const bg = document.createElement('canvas'); bg.width = MW * md; bg.height = MH * md; const bgc = bg.getContext('2d'); bgc.scale(md, md);
    bgc.save(); AR.rrect(bgc, 2, 2, MW - 4, MH - 4, 22); bgc.clip(); AR.drawGrass(bgc, MW, MH, 30, 5);
    const pts = []; for (let x = -20; x <= MW + 20; x += 20) pts.push([x, 92 + Math.sin(x / 55) * 14]);
    AR.drawPath(bgc, pts, 30); bgc.restore();
    AR.rrect(bgc, 2, 2, MW - 4, MH - 4, 22); bgc.lineWidth = 4; bgc.strokeStyle = AR.OUT; bgc.stroke();
    const towers = [['arrow', 2, 70, 40], ['cannon', 1, 200, 36], ['frost', 2, 330, 40], ['arrow', 0, 410, 132], ['cannon', 2, 120, 134]];
    for (const [, , x, y] of towers) { const pd = AR.pad('#4fa3ff', 0, 30); bgc.drawImage(pd.c, x - pd.w / 2, y - pd.h / 2, pd.w, pd.h); }
    const blobs = [['neutral', 1, 7], ['neutral', 2, 7], ['runner', 2, 8], ['swarm', 3, 6.5], ['brute', 3, 10.5], ['neutral', 4, 7], ['boss', 0, 13], ['runner', 3, 8], ['brute', 2, 10.5], ['swarm', 1, 6.5]];
    function frame() {
      requestAnimationFrame(frame);
      if ($('menu').classList.contains('hidden')) return;
      const now = performance.now();
      g.setTransform(md, 0, 0, md, 0, 0); g.clearRect(0, 0, MW, MH); g.drawImage(bg, 0, 0, MW, MH);
      g.save(); AR.rrect(g, 2, 2, MW - 4, MH - 4, 22); g.clip();
      for (let i = 0; i < blobs.length; i++) {
        const [k, v, R] = blobs[i]; const x = ((now / 28 + i * 52) % (MW + 80)) - 40, y = 92 + Math.sin(x / 55) * 14;
        const b = Math.abs(Math.sin(now / 130 + i)); const sp = AR.creep(k, v, R), sh = AR.shadow(R);
        g.drawImage(sh.c, x - sh.w / 2, y + R * 0.55 - sh.h / 2, sh.w, sh.h);
        g.drawImage(sp.c, x - sp.w / 2, y - b * R * 0.35 - sp.h / 2, sp.w, sp.h);
      }
      for (const [t, l, x, y] of towers) {
        const sp = AR.tower(t, l), a = t === 'frost' ? 0 : Math.atan2(92 - y, ((now / 28) % 200) + 100 - x) + Math.PI / 2;
        if (t === 'frost') g.drawImage(sp.c, x - sp.w / 2, y - sp.h / 2 - 2, sp.w, sp.h);
        else { g.save(); g.translate(x, y); g.rotate(a); g.drawImage(sp.c, -sp.w / 2, -sp.h / 2, sp.w, sp.h); g.restore(); }
      }
      g.restore();
    }
    frame();
  })();

  // read-only hooks for the headless smoke test
  window.__ftdState = () => state; window.__ftdWouldBlock = (b, c, r) => wouldBlock(b, c, r);

  // auto-join if room in URL and we have a token (refresh case)
  const urlRoom = params.get('room');
  if (urlRoom && localStorage.getItem('ftd_token_' + urlRoom.toUpperCase())) $('joinBtn').click();
})();
