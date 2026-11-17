// Lobby/host/rematch/limits checks. Run against a server started with:
//   PORT=8723 SPEED=20 JOIN_TIMEOUT_MS=2000 MAX_ROOMS=6 FORGE_TEST_HOOKS=1 node server.js
// Usage: node test/lifecycle.js ws://localhost:8723 [serverLogPath]
const fs = require('fs');
const { client, game, sleep } = require('./lib');
const URL_ = process.argv[2] || 'ws://localhost:8723';
const LOG = process.argv[3];
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  // tick exception: log once, room reset to lobby
  const log0 = LOG ? fs.statSync(LOG).size : 0;
  let [a, b] = await game(URL_, 2);
  a.send({ t: 'debug_crash' });
  await sleep(1500);
  const logTxt = LOG ? fs.readFileSync(LOG, 'utf8').slice(log0) : '';
  const traces = (logTxt.match(/ERROR in tick/g) || []).length;
  check('tick exception: room reset to lobby', a.lobby.phase === 'lobby' && b.lobby.phase === 'lobby', a.lobby.phase);
  check('tick exception: players told', a.errs.some((e) => /server error/.test(e)), a.errs);
  if (LOG) check('tick exception: logged exactly once', traces === 1, { traces, logBytes: logTxt.length });
  // the same room can start again
  b.send({ t: 'ready', ready: true }); await sleep(150); a.send({ t: 'start' }); await sleep(400);
  check('room playable again after crash reset', a.state && a.state.phase === 'game' && a.lobby.phase === 'game');
  a.ws.close(); b.ws.close();

  // 2v2: non-host drops mid-game; game ends (no towers -> fast); host returns to lobby; ghost removed; rematch starts
  let [h, p1, p2, p3] = await game(URL_, 4);
  p2.ws.terminate();
  check('2v2 game reaches game over (SPEED=20, no towers)', await waitFor(() => h.state && h.state.phase === 'over'), h.state && h.state.time);
  h.send({ t: 'lobby' }); await sleep(300);
  check('lobby reset drops the disconnected player', h.lobby.phase === 'lobby' && h.lobby.players.length === 3 && !h.lobby.players.some((p) => p.id === p2.id), h.lobby.players.map((p) => p.name));
  p1.send({ t: 'ready', ready: true }); p3.send({ t: 'ready', ready: true }); await sleep(200);
  h.errs = []; h.send({ t: 'start' }); await sleep(300);
  check('rematch with 3 players (uneven) is blocked with a clear reason, not "Waiting for"', h.errs.some((e) => /even/.test(e)) && !h.errs.some((e) => /Waiting for/.test(e)), h.errs);
  // make it 1v1 by moving: p1 is R? put h=L, p3=R, p1 leaves
  p1.ws.close(); await sleep(300);
  const teams = Object.fromEntries(h.lobby.players.map((p) => [p.id, p.team]));
  if (teams[h.id] === teams[p3.id]) { p3.send({ t: 'team', team: teams[h.id] === 'L' ? 'R' : 'L' }); await sleep(200); p3.send({ t: 'ready', ready: true }); await sleep(200); }
  h.errs = []; h.send({ t: 'start' }); await sleep(400);
  check('rematch 1v1 starts after ghosts are gone', h.lobby.phase === 'game', h.errs);
  // host drops mid-game -> remaining player becomes host and can return to lobby after game over
  h.ws.terminate(); await sleep(300);
  check('host migrates to the remaining connected player', p3.lobby.hostId === p3.id, p3.lobby.hostId);
  check('game reaches over', await waitFor(() => p3.state && p3.state.phase === 'over'));
  p3.send({ t: 'lobby' }); await sleep(300);
  check('new host can return to lobby; old host removed', p3.lobby.phase === 'lobby' && p3.lobby.players.length === 1 && p3.lobby.hostId === p3.id, p3.lobby);
  p3.ws.close();

  // reconnect by token mid-game restores the seat and full tower state
  [a, b] = await game(URL_, 2);
  a.send({ t: 'build', type: 'arrow', c: 0, r: 5 }); await sleep(200);
  const tok = a.token, code = a.code; a.ws.terminate(); await sleep(200);
  const a2 = await client(URL_, 'P0'); a2.send({ t: 'join', code, token: tok }); await sleep(300);
  check('rejoin by token: same id + full tower list in first state', a2.id === a.id && a2.rejoined && a2.state && a2.state.boards.L.towers.length === 1, a2.state && a2.state.boards.L.towers);
  a2.ws.close(); b.ws.close();
  // room not found
  const nf = await client(URL_, 'x'); nf.send({ t: 'join', code: 'ZZZZ' }); await sleep(200);
  check('unknown room -> "not found" error', nf.errs.some((e) => /not found/.test(e)), nf.errs); nf.ws.close();

  // idle socket closed after JOIN_TIMEOUT_MS
  const idle = await client(URL_, 'idle'); await sleep(2600);
  check('socket that never joins is closed after timeout', idle.closed, idle.closeCode);
  // room cap (MAX_ROOMS=6)
  await sleep(500);
  const makers = []; for (let i = 0; i < 8; i++) { const c = await client(URL_, 'm' + i); c.send({ t: 'create', name: 'm' }); makers.push(c); }
  await sleep(500);
  const full = makers.filter((c) => c.errs.some((e) => /Server is full/.test(e))).length;
  check('room cap: extra creates refused', full >= 2, { refused: full });
  makers.forEach((c) => c.ws.close());
  // per-IP connection cap (24)
  await sleep(500);
  const conns = []; let refused = 0;
  for (let i = 0; i < 30; i++) { try { const c = await client(URL_, 'c' + i); conns.push(c); } catch (e) { refused++; } }
  await sleep(500);
  const closedByCap = conns.filter((c) => c.closed && c.closeCode === 1008).length;
  check('per-IP connection cap (24): extra sockets closed', closedByCap + refused >= 5, { closedByCap, refused });
  conns.forEach((c) => c.ws.close());
  console.log(fails ? `LIFECYCLE TESTS: ${fails} FAILED` : 'LIFECYCLE TESTS: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
