// Headless-browser screenshots + render-cost measurement for a busy 2v2 (needs puppeteer-core + Chrome, like smoke.js).
// Server must run with FORGE_TEST_HOOKS=1 (gold top-up) and ideally SPEED=10..20 so the match reaches upgrade waves quickly:
//   PORT=8741 SPEED=12 FORGE_TEST_HOOKS=1 node server.js &   node test/shots.js http://localhost:8741 /workspace/forge-td-shots
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const path = require('path'), fs = require('fs');
const WebSocket = require('ws');
const S = require('../public/shared.js');
const URL_ = process.argv[2] || 'http://localhost:8741', OUT = process.argv[3] || '/workspace/forge-td-shots';
const WAVE = +(process.env.SHOT_WAVE || 17);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
// serpentine maze rows for each team; players alternate cells
const ORDER = [];
[3, 6, 9, 12, 15].forEach((r, wi) => { const gapLeft = wi % 2 === 0; for (let c = 0; c < 11; c++) if (gapLeft ? c !== 0 : c !== 10) ORDER.push([c, r]); });
function bot(name, code) {
  return new Promise((res) => {
    const ws = new WebSocket(URL_.replace(/^http/, 'ws')); const b = { ws, state: null, id: null, name };
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'joined') b.id = m.you; if (m.t === 's') { for (const k of ['L', 'R']) if (!m.boards[k].towers) m.boards[k].towers = b.state ? b.state.boards[k].towers : []; b.state = m; } });
    ws.on('open', () => { ws.send(JSON.stringify(code ? { t: 'join', code, name } : { t: 'create', name })); res(b); });
  });
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.createBrowserContext(); const A = await ctx.newPage();
  const errors = []; A.on('pageerror', (e) => errors.push(e.message)); A.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await A.evaluateOnNewDocument(() => { const W = window.WebSocket; window.__sockets = []; window.WebSocket = function (...a) { const s = new W(...a); window.__sockets.push(s); return s; }; window.WebSocket.prototype = W.prototype; });
  await A.setViewport({ width: 1120, height: 780, deviceScaleFactor: 2 });
  await A.goto(URL_); await A.evaluate(() => document.fonts.ready); await sleep(1200);
  await A.screenshot({ path: path.join(OUT, 'menu.png') });
  await A.type('#name', 'Alice'); await A.click('#createBtn');
  await A.waitForFunction(() => document.getElementById('lobbyCode').textContent.length === 4);
  const code = await A.$eval('#lobbyCode', (e) => e.textContent);
  const bots = [await bot('Bob', code), await bot('Cara', code), await bot('Dan', code)];
  await sleep(500);
  // Alice + Cara on L, Bob + Dan on R (join order alternates teams)
  for (const b of bots) b.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  await sleep(500);
  await A.screenshot({ path: path.join(OUT, 'lobby.png') });
  await A.click('#startBtn');
  await A.waitForFunction(() => !document.getElementById('game').classList.contains('hidden'));
  await A.waitForFunction(() => window.__ftdState && window.__ftdState() && window.__ftdState().phase === 'game');
  const aSend = (m) => A.evaluate((m) => window.__sockets[window.__sockets.length - 1].send(JSON.stringify(m)), m);
  const players = [{ send: aSend, get: () => A.evaluate(() => window.__ftdState()) }, ...bots.map((b) => ({ send: async (m) => b.ws.send(JSON.stringify(m)), get: async () => b.state, b }))];
  const types = ['arrow', 'cannon', 'frost', 'arrow'];
  let ti = 0;
  for (let step = 0; step < 4000; step++) {
    const st = await players[0].get(); if (!st || st.phase !== 'game') break;
    for (const [i, P] of players.entries()) {
      const s = await P.get(); if (!s) continue;
      const me = s.players.find((p) => (P.b ? p.id === P.b.id : p.name === 'Alice'));
      if (!me) continue;
      if (me.gold < 3000) await P.send({ t: 'debug_gold' });
      const B = s.boards[me.team];
      const mine = B.towers.filter((t) => t[5] === me.id);
      // build next maze cells (players on a team alternate cells), then upgrade a little
      const idx = i < 2 ? i : i - 2; // two players per team
      const free = ORDER.filter(([c, r], k) => k % 2 === (me.team === 'L' ? (i === 0 ? 0 : 1) : (i === 1 ? 0 : 1)) && !B.towers.some((t) => t[1] === c && t[2] === r));
      if (free.length && s.wave >= 1) { const [c, r] = free[0]; await P.send({ t: 'build', type: types[(ti++ + idx) % 4], c, r }); }
      const up = mine.find((t) => t[4] < ((t[0] + t[1]) % 3)); // mixed levels 0..2
      if (up) await P.send({ t: 'upgrade', c: up[1], r: up[2] });
      for (const k of Object.keys(S.SENDS)) if (s.wave >= S.SEND_UP.UNLOCK_WAVE[(me.tiers[k] || 0) + 1] && (me.tiers[k] || 0) < 3) await P.send({ t: 'sendup', kind: k });
      if (s.wave >= 8 && step % 6 === i % 6 && Math.min(s.boards.L.lives, s.boards.R.lives) > 12) await P.send({ t: 'send', kind: Object.keys(S.SENDS)[(step + i) % 3] });
    }
    if (st.wave >= WAVE) break;
    await sleep(120);
  }
  // let the boards fill with upgraded sends, then hover a build ghost and select a tower for the screenshot
  for (let k = 0; k < 6; k++) { for (const [i, P] of players.entries()) await P.send({ t: 'send', kind: Object.keys(S.SENDS)[(k + i) % 3] }); await sleep(120); }
  const cv = await A.$('#cv'); const box = await cv.boundingBox();
  const st = await players[0].get();
  const myT = st.boards.L.towers.find((t) => t[5] === st.players.find((p) => p.name === 'Alice').id && t[4] === 2) || st.boards.L.towers[0];
  if (myT) await A.mouse.click(box.x + (20 + myT[1] * 30 + 15) * box.width / 760, box.y + (44 + myT[2] * 30 + 15) * box.height / 660);
  await A.keyboard.press('2');
  await A.mouse.move(box.x + (20 + 2 * 30 + 15) * box.width / 760, box.y + (44 + 17 * 30 + 15) * box.height / 660);
  await A.evaluate(() => window.__ftdResetFrameStats());
  await sleep(1200);
  const live = await A.evaluate(() => window.__ftdState().phase);
  if (live !== 'game') console.log('WARNING: game is no longer running at screenshot time:', live);
  await A.screenshot({ path: path.join(OUT, 'game-2v2.png') });
  await A.screenshot({ path: path.join(OUT, 'game-2v2-zoom.png'), clip: { x: box.x, y: box.y + box.height * 0.05, width: box.width * 0.47, height: box.height * 0.5 } });
  await cv.screenshot({ path: path.join(OUT, 'game-2v2-boards.png') });
  const info = await A.evaluate(() => { const s = window.__ftdState(); return { wave: s.wave, creeps: s.boards.L.creeps.length + s.boards.R.creeps.length, towers: s.boards.L.towers.length + s.boards.R.towers.length, lvls: [0, 1, 2].map((l) => [...s.boards.L.towers, ...s.boards.R.towers].filter((t) => t[4] === l).length), tiers: s.players.map((p) => p.name + ':' + JSON.stringify(p.tiers)), creepTiers: [...s.boards.L.creeps, ...s.boards.R.creeps].filter((c) => c[1] !== 'neutral' && c[1] !== 'boss').reduce((o, c) => (o[c[1] + c[8]] = (o[c[1] + c[8]] || 0) + 1, o), {}), fx: window.__ftdFx(), frame: window.__ftdFrameStats() }; });
  console.log(JSON.stringify(info));
  console.log('errors:', JSON.stringify(errors.slice(0, 5)));
  await browser.close(); for (const b of bots) b.ws.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
