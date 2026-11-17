// v0.3 network checks: seat takeover (4001 'replaced'), join errors carry a code, per-IP cap vs forged proxy headers,
// queued sales over the wire. Usage: node test/v03.js ws://localhost:PORT [trustproxy]
// Run against a normal server (with FORGE_TEST_HOOKS=1 the queued-sale check also proves the 20 s hard cap);
// with "trustproxy" against TRUST_PROXY=1; with "trustcf" against TRUST_CF=1.
const { client, game, sleep, WebSocket } = require('./lib');
const S = require('../public/shared.js');
const URL_ = process.argv[2] || 'ws://localhost:8080';
const MODE = process.argv[3] || ''; // '' | 'trustproxy' | 'trustcf'
const TRUST = MODE === 'trustproxy' || MODE === 'trustcf';
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const raw = (c) => { const msgs = []; c.ws.on('message', (d) => { try { msgs.push(JSON.parse(d)); } catch (e) {} }); return msgs; };
async function capTest(headersFor) {
  const socks = []; let capped = 0, opened = 0;
  for (let i = 0; i < 40; i++) {
    const w = new WebSocket(URL_, { headers: headersFor(i) });
    w.on('open', () => opened++); w.on('close', (c) => { if (c === 1008) capped++; }); w.on('error', () => {}); socks.push(w);
  }
  await sleep(1000); socks.forEach((w) => w.terminate()); await sleep(400);
  return { capped, opened };
}
(async () => {
  if (!TRUST) {
    // --- takeover ---
    const [a, b] = await game(URL_, 2); await sleep(200);
    const oldMsgs = raw(b); let oldClose = null; b.ws.on('close', (c, r) => (oldClose = [c, String(r)]));
    const b2 = await client(URL_, 'P1b'); b2.send({ t: 'join', code: a.code, token: b.token }); await sleep(500);
    check('takeover: old socket closed with 4001 "replaced"', oldClose && oldClose[0] === 4001 && oldClose[1] === 'replaced', oldClose);
    check('takeover: old socket told err code "replaced" first', oldMsgs.some((m) => m.t === 'err' && m.code === 'replaced'));
    check('takeover: new socket has the seat', b2.id === b.id && b2.rejoined === true);
    // --- join error codes ---
    const late = await client(URL_, 'late'); const lm = raw(late); late.send({ t: 'join', code: a.code, name: 'late' }); await sleep(300);
    check('join while game in progress -> err code "joinfail"', lm.some((m) => m.t === 'err' && m.code === 'joinfail' && /in progress/.test(m.msg)), lm.filter((m) => m.t === 'err'));
    const nr = await client(URL_, 'nr'); const nm = raw(nr); nr.send({ t: 'join', code: 'QQQQ' }); await sleep(300);
    check('join unknown room -> err code "noroom"', nm.some((m) => m.t === 'err' && m.code === 'noroom'));
    // --- queued sale over the wire (v0.5.1: route-changing sale -> SELL_HARD_CAP) ---
    // A single arrow ON the straight spawn->base route (column 5) changes the route, so while the board is busy its sale
    // must wait the full SELL_HARD_CAP (20 s), not SELL_MAX_WAIT (10 s). With FORGE_TEST_HOOKS=1 the enemy floods brutes
    // so the board stays busy past 20 s; without hooks the board may clear first, which is also a valid early sale.
    a.send({ t: 'build', type: 'arrow', c: 5, r: 6 }); await sleep(300);
    check('state carries board busy flag', a.state.boards.L.busy === 0 || a.state.boards.L.busy === 1, a.state.boards.L.busy);
    const g0 = b2.me() && b2.me().gold; b2.send({ t: 'debug_gold' }); await sleep(300);
    const hooks = b2.me() && b2.me().gold > (g0 || 0) + 1000;
    const t0 = Date.now(); while (Date.now() - t0 < 25000 && !(a.state.boards.L.busy && a.state.boards.L.creeps.length)) await sleep(100);
    let sends = 0; const flood = setInterval(() => { if (hooks && sends < 40) { b2.send({ t: 'send', kind: 'brute' }); sends++; } }, 250);
    await sleep(hooks ? 1500 : 0);
    a.send({ t: 'sell', c: 5, r: 6 }); await sleep(300);
    const tw = a.state.boards.L.towers.find((t) => t[1] === 5 && t[2] === 6);
    check('sell while creeps on board -> tower stays, flagged sale-queued', tw && tw[6] === 1, tw);
    const t1 = Date.now(); let busyAtSale = null;
    while (Date.now() - t1 < 40000 && a.state.boards.L.towers.some((t) => t[1] === 5 && t[2] === 6)) { busyAtSale = a.state.boards.L.busy; await sleep(100); }
    clearInterval(flood);
    const gone = !a.state.boards.L.towers.some((t) => t[1] === 5 && t[2] === 6);
    const waited = (Date.now() - t1) / 1000 + 0.3;
    if (hooks) check(`route-changing queued sale on a busy board executes at the ${S.SELL_HARD_CAP} s hard cap (v0.5)`, gone && busyAtSale === 1 && waited >= S.SELL_HARD_CAP - 0.6 && waited <= S.SELL_HARD_CAP + 2, { waited: +waited.toFixed(1), busyAtSale, sends });
    else check(`route-changing queued sale executes when the board clears, never before the ${S.SELL_HARD_CAP} s hard cap while busy (no hooks)`, gone && (busyAtSale === 0 || waited >= S.SELL_HARD_CAP - 0.6), { waited: +waited.toFixed(1), busyAtSale });
    [a, b2, late, nr].forEach((c) => c.ws.close());
    await sleep(300);
    // --- per-IP cap ignores proxy headers without TRUST_PROXY ---
    const xff = await capTest((i) => ({ 'X-Forwarded-For': `10.0.${i}.1` }));
    check('no TRUST_PROXY: 40 sockets with forged X-Forwarded-For -> 16 refused by the 24/IP cap', xff.capped === 16, xff);
    const cf = await capTest((i) => ({ 'CF-Connecting-IP': `10.1.${i}.1`, 'True-Client-IP': `10.2.${i}.1` }));
    check('no TRUST_PROXY: forged CF-Connecting-IP/True-Client-IP also capped', cf.capped === 16, cf);
  } else if (MODE === 'trustproxy') {
    // v0.4: TRUST_PROXY alone trusts only the last X-Forwarded-For hop; CF headers are client-forgeable off Cloudflare
    const cf = await capTest((i) => ({ 'CF-Connecting-IP': `203.0.113.${i + 1}`, 'True-Client-IP': `203.0.114.${i + 1}` }));
    check('TRUST_PROXY (no TRUST_CF): distinct forged CF-Connecting-IP/True-Client-IP are ignored -> 16 refused', cf.capped === 16, cf);
    const xf = await capTest((i) => ({ 'X-Forwarded-For': `10.0.${i}.1, 198.51.100.9` }));
    check('TRUST_PROXY: last X-Forwarded-For hop is the key (forged first values ignored)', xf.capped === 16, xf);
    const xf2 = await capTest((i) => ({ 'X-Forwarded-For': `198.51.100.${i + 1}` }));
    check('TRUST_PROXY: distinct last hops are counted separately', xf2.capped === 0, xf2);
  } else {
    const same = await capTest(() => ({ 'CF-Connecting-IP': '203.0.113.7' }));
    check('TRUST_CF: 40 sockets with the same CF-Connecting-IP -> 16 refused', same.capped === 16, same);
    const diff = await capTest((i) => ({ 'CF-Connecting-IP': `203.0.113.${i + 1}` }));
    check('TRUST_CF: distinct CF-Connecting-IP values are counted separately', diff.capped === 0, diff);
  }
  console.log(fails ? `V03 TESTS: ${fails} FAILED` : 'V03 TESTS: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
