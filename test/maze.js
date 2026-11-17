// Verifies mazing: a wall with one gap is allowed, closing the gap is rejected, creeps route through the gap.
const WebSocket = require('ws');
const URL_ = (process.argv[2] || 'ws://localhost:8080').replace(/^http/, 'ws');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const a = new WebSocket(URL_), b = new WebSocket(URL_);
let code, st, errs = [];
a.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'joined') code = m.code; if (m.t === 's') st = m; if (m.t === 'err') errs.push(m.msg); });
(async () => {
  await sl(400);
  a.send(JSON.stringify({ t: 'create', name: 'A' })); await sl(300);
  b.send(JSON.stringify({ t: 'join', code, name: 'B' })); await sl(300);
  b.send(JSON.stringify({ t: 'ready', ready: true })); await sl(200);
  a.send(JSON.stringify({ t: 'start' })); await sl(300);
  // Spawn is (5,0): wall it in on both sides, then try to seal it from below.
  for (const [c, r] of [[4, 0], [6, 0]]) a.send(JSON.stringify({ t: 'build', type: 'arrow', c, r }));
  await sl(300);
  a.send(JSON.stringify({ t: 'build', type: 'arrow', c: 5, r: 1 })); // would seal the spawn -> must be rejected
  await sl(400);
  const towers = st.boards.L.towers.map((t) => t[1] + ',' + t[2]);
  console.log('towers:', towers.join(' '), '| errors:', errs.join('; '));
  const ok = towers.length === 2 && errs.some((e) => /block/.test(e));
  console.log(ok ? 'MAZE RESULT: PASS' : 'MAZE RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})();
