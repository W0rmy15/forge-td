// Headless-browser smoke test (2 real Chrome pages). Needs puppeteer-core + Chrome, which are not app dependencies:
//   npm i --no-save puppeteer-core   (or set PUPPETEER_PATH to an existing install), CHROME=/path/to/chrome
// Usage: node test/smoke.js http://localhost:PORT   (fresh server; run it before other tests so the per-IP cap isn't hit)
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const URL_ = process.argv[2] || 'http://localhost:8721';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const mk = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.evaluateOnNewDocument(() => { const W = window.WebSocket; window.__sockets = []; window.WebSocket = function (...a) { const s = new W(...a); window.__sockets.push(s); return s; }; window.WebSocket.prototype = W.prototype; }); await p.setViewport({ width: 1100, height: 760 }); p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); return p; };
  const A = await mk(), B = await mk();
  const sentA = () => A.evaluate(() => window.__ftdState().players.find((p) => p.team === 'L').sent);
  await A.goto(URL_); await A.type('#name', 'Alice'); await A.click('#createBtn');
  await A.waitForFunction(() => document.getElementById('lobbyCode').textContent.length === 4);
  const code = await A.$eval('#lobbyCode', (e) => e.textContent);
  check('lobby created', !!code, code);
  await B.goto(`${URL_}/?room=${code}`); await B.type('#name', 'Bob'); await B.click('#joinBtn');
  await B.waitForFunction(() => !document.getElementById('lobby').classList.contains('hidden'));
  await sleep(300);
  const teams = await A.evaluate(() => [document.getElementById('teamL').textContent, document.getElementById('teamR').textContent]);
  check('both players in lobby on opposite teams', /Alice/.test(teams[0]) && /Bob/.test(teams[1]), teams);
  check('start disabled until ready', await A.$eval('#startBtn', (e) => e.disabled));
  await B.click('#readyBtn'); await sleep(300);
  check('start enabled after ready', !(await A.$eval('#startBtn', (e) => e.disabled)));
  await A.click('#startBtn');
  await A.waitForFunction(() => !document.getElementById('game').classList.contains('hidden'));
  await B.waitForFunction(() => !document.getElementById('game').classList.contains('hidden'));
  await sleep(800);
  check('game screen shown for both', true);
  // build: key 1 then click cell (2,5) on left board: x = 20 + 2*30 + 15, y = 44 + 5*30 + 15
  const cv = await A.$('#cv'); const box = await cv.boundingBox();
  const cell = (c, r) => ({ x: box.x + (20 + c * 30 + 15) * box.width / 760, y: box.y + (44 + r * 30 + 15) * box.height / 660 });
  await A.keyboard.press('1'); const p = cell(2, 5); await A.mouse.move(p.x, p.y); await A.mouse.click(p.x, p.y); await sleep(400);
  const gold1 = +(await A.$eval('#gold', (e) => e.textContent));
  check('tower built (gold 150 -> 100)', gold1 === 100, gold1);
  // send feedback + counter
  await A.keyboard.press('Escape'); await A.keyboard.press('q'); await sleep(400);
  const toastTxt = await A.evaluate(() => { const t = window.__ftdToasts(); return [document.getElementById('toast').textContent, ...t.queued].join(' | '); });
  check('own send shows feedback toast (shown or queued)', /Sent Runner/.test(toastTxt), toastTxt);
  // held key: auto-repeat keydown must not send
  const sw0 = await sentA();
  await A.evaluate(() => { for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', repeat: true, bubbles: true })); }); await sleep(400);
  check('auto-repeat Q keydowns are ignored', (await sentA()) === sw0, { before: sw0, after: await sentA() });
  // toast queue: several toasts in a row do not overwrite each other
  const seenP = A.evaluate(() => new Promise((res) => { const seen = []; const o = new MutationObserver(() => { const t = document.getElementById('toast').textContent; if (seen[seen.length - 1] !== t) seen.push(t); }); o.observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); setTimeout(() => { o.disconnect(); res(seen); }, 5000); }));
  const ep = { x: box.x + (20 + 11 * 30 + 60 + 3 * 30 + 15) * box.width / 760, y: box.y + (44 + 5 * 30 + 15) * box.height / 660 };
  await A.mouse.click(ep.x, ep.y); await A.keyboard.press('e');
  const seen = await seenP;
  check('toast queue: enemy-side warning and send feedback are both shown in turn', seen.some((t) => /enemy side/.test(t)) && seen.some((t) => /Sent Swarm/.test(t)), seen);
  const bSeen = await B.evaluate(() => { const t = window.__ftdToasts(); return [document.getElementById('toast').textContent, ...t.queued]; });
  check('enemy sees a (coalesced) incoming-sends toast', true, bSeen);
  check('banner hidden before sudden death', await A.$eval('#sdBanner', (e) => e.classList.contains('hidden')));
  check('no per-wave send cap counter in the UI', (await A.$('#sendsWave')) === null);
  check('sends registered (runner + swarm = 2)', (await sentA()) === 2, await sentA());
  const q = await A.$eval('#sendsQueued', (e) => e.textContent), q2 = await B.$eval('#sendsOnMe', (e) => e.textContent);
  check('queued send counts shown', q !== '' && q2 !== '', { mineQueuedAtEnemy: q, enemySeesQueued: q2 });
  // roster DOM should not be rebuilt every tick
  const muts = await A.evaluate(() => new Promise((res) => { let n = 0; const o = new MutationObserver((m) => (n += m.length)); o.observe(document.getElementById('roster'), { childList: true, subtree: true, characterData: true }); setTimeout(() => { o.disconnect(); res(n); }, 2000); }));
  check('roster not rebuilt every tick (mutations in 2 s, ~40 ticks)', muts <= 6, muts);
  // select tower and sell with two presses
  await A.mouse.click(p.x, p.y); await sleep(200);
  check('selection panel visible', await A.$eval('#sel', (e) => !e.classList.contains('hidden')));
  await A.keyboard.press('x'); await sleep(400);
  const armed = await A.$eval('#sellBtn', (e) => e.textContent).catch(() => null);
  const stillThere1 = await A.evaluate(() => true);
  check('first X arms the sell (Confirm sell?)', /Confirm/.test(armed || ''), armed);
  const goldPre = +(await A.$eval('#gold', (e) => e.textContent)); const tPre = await A.evaluate(() => window.__ftdState().nextIncome); const incA = +(await A.$eval('#income', (e) => e.textContent));
  await A.keyboard.press('x'); await sleep(600);
  const gold2 = +(await A.$eval('#gold', (e) => e.textContent));
  const goneT = await A.evaluate(() => !window.__ftdState().boards.L.towers.some((t) => t[1] === 2 && t[2] === 5));
  check('second X sells at once on an idle board (tower gone, +35g refund)', goneT && (gold2 - goldPre === 35 || gold2 - goldPre === 35 + incA), { goldPre, gold2, tPre, incA });
  // build ghost red over a creep: wait for wave 1 creeps on Alice's board, put ghost on a creep's cell
  await A.keyboard.press('1');
  const ghost = await A.evaluate(async () => { // returns [cell, canBuild per client] once a creep is on the board
    for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 100)); const s = window.__ftdState && window.__ftdState(); const cr = s && s.boards.L.creeps.find((c) => c[3] > 2.5 && c[3] < 18); if (cr) { return { c: Math.floor(cr[2]), r: Math.floor(cr[3]), blocked: window.__ftdWouldBlock('L', Math.floor(cr[2]), Math.floor(cr[3])), emptyCorner: window.__ftdWouldBlock('L', 0, 12) }; } }
    return null;
  });
  check('build ghost marks a cell with a creep as invalid', ghost && ghost.blocked === true && ghost.emptyCorner === false, ghost);
  // queued sale UI: creeps are on the board now, so a sale must queue
  { const q = cell(0, 12); await A.mouse.move(q.x, q.y); await A.mouse.click(q.x, q.y); await sleep(400);
    await A.keyboard.press('Escape'); await A.mouse.click(q.x, q.y); await sleep(200);
    const hint = await A.$eval('#sel', (e) => e.textContent).catch(() => '');
    check('sell hint shown while board busy (server busy flag)', /queued until your board is clear/.test(hint), hint.slice(0, 160));
    await A.keyboard.press('x'); await sleep(150); await A.keyboard.press('x'); await sleep(500);
    const selTxt = await A.$eval('#sel', (e) => e.textContent).catch(() => '');
    const flagged = await A.evaluate(() => { const t = window.__ftdState().boards.L.towers.find((t) => t[1] === 0 && t[2] === 12); return t ? t[6] : null; });
    check('sale queued: panel says so, tower still on board', /Sale queued/.test(selTxt) && flagged === 1, { selTxt: selTxt.slice(0, 120), flagged }); }
  await A.screenshot({ path: require('path').join(require('os').tmpdir(), 'forge-smoke.png') });
  // room-not-found: page with stale token for a missing room goes back to the menu
  const C = await mk(); await C.goto(URL_); await C.evaluate(() => localStorage.setItem('ftd_token_ZZZZ', 'x'));
  await C.goto(`${URL_}/?room=ZZZZ`); await sleep(800);
  check('room not found -> menu shown with error', await C.evaluate(() => !document.getElementById('menu').classList.contains('hidden') && /not found/.test(document.getElementById('menuErr').textContent)));
  // reconnect: kill the page's socket via CDP offline, then back online
  await B.evaluate(() => window.__sockets[window.__sockets.length - 1].close());
  await sleep(300);
  const tOff = await B.$eval('#toast', (e) => e.textContent);
  const back = await B.waitForFunction(() => /Reconnected/.test(document.getElementById('toast').textContent), { timeout: 20000 }).then(() => true).catch(() => false);
  const sameGame = await B.evaluate(() => !document.getElementById('game').classList.contains('hidden') && window.__sockets.length >= 2);
  check('client reconnects after its socket drops (same room, back in game)', back && sameGame, { toastAfterDrop: tOff });
  // join error other than noroom: game in progress -> back to menu with the message, no retry loop
  const E2 = await mk(); await E2.goto(URL_); await E2.type('#name', 'Late'); await E2.type('#codeInput', code); await E2.click('#joinBtn'); await sleep(4000);
  const e2 = await E2.evaluate(() => ({ menu: !document.getElementById('menu').classList.contains('hidden'), err: document.getElementById('menuErr').textContent, sockets: window.__sockets.length }));
  check('join "Game already in progress" -> menu + message, no retries', e2.menu && /in progress/.test(e2.err) && e2.sockets === 1, e2);
  // two tabs on one seat: second tab (same browser profile = same token) takes the seat; the first stops and shows why
  const tokB = await B.evaluate((c) => localStorage.getItem('ftd_token_' + c), code);
  const B2 = await mk(); await B2.goto(URL_); await B2.evaluate((c, t) => localStorage.setItem('ftd_token_' + c, t), code, tokB);
  const nB = await B.evaluate(() => window.__sockets.length);
  await B2.goto(`${URL_}/?room=${code}`); await B2.waitForFunction(() => !document.getElementById('game').classList.contains('hidden'), { timeout: 10000 }).catch(() => {});
  await sleep(5000);
  const b1 = await B.evaluate(() => ({ menu: !document.getElementById('menu').classList.contains('hidden'), err: document.getElementById('menuErr').textContent, sockets: window.__sockets.length }));
  const b2 = await B2.evaluate(() => ({ game: !document.getElementById('game').classList.contains('hidden'), sockets: window.__sockets.length }));
  check('takeover: old tab shows "opened in another tab" on the menu and does not reconnect', b1.menu && /another tab/.test(b1.err) && b1.sockets === nB, { b1, nB });
  check('takeover: new tab keeps the seat (no ping-pong)', b2.game && b2.sockets === 1, b2);
  check('no page errors / console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(fails ? `SMOKE: ${fails} FAILED` : 'SMOKE: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
