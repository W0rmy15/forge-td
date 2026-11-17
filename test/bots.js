// Headless test: N bot clients join a room, start, build, upgrade, send, and play until game over or timeout.
// Usage: node test/bots.js [url] [players=4] [seconds=60]
const WebSocket = require('ws');
const S = require('../public/shared.js');
const URL_ = (process.argv[2] || 'ws://localhost:8080').replace(/^http/, 'ws');
const N = parseInt(process.argv[3] || '4', 10);
const SECS = parseInt(process.argv[4] || '60', 10);
const bots = [];
let code = null, errors = [], states = 0, lastState = null, maxCreeps = 0, sendsOk = 0, built = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(i) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL_);
    const bot = { i, ws, id: null, lobby: null, state: null };
    ws.on('open', () => res(bot));
    ws.on('error', rej);
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'joined') { bot.id = m.you; code = m.code; }
      else if (m.t === 'lobby') bot.lobby = m;
      else if (m.t === 's') { bot.state = m; if (i === 0) { states++; lastState = m; maxCreeps = Math.max(maxCreeps, m.boards.L.creeps.length + m.boards.R.creeps.length); } }
      else if (m.t === 'err') errors.push(`bot${i}: ${m.msg}`);
    });
    bots.push(bot);
  });
}
(async () => {
  const host = await mk(0);
  host.ws.send(JSON.stringify({ t: 'create', name: 'Bot0' }));
  await sleep(300);
  if (!code) throw new Error('no room code');
  console.log('room', code);
  for (let i = 1; i < N; i++) { const b = await mk(i); b.ws.send(JSON.stringify({ t: 'join', code, name: 'Bot' + i })); }
  await sleep(400);
  for (const b of bots.slice(1)) b.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  await sleep(300);
  const lob = host.lobby;
  console.log('lobby:', lob.players.map((p) => `${p.name}:${p.team}:${p.ready ? 'R' : '-'}`).join(' '));
  host.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(500);
  if (!host.state) throw new Error('game did not start');
  console.log('game started');
  // test invalid actions
  host.ws.send(JSON.stringify({ t: 'build', type: 'arrow', c: S.SPAWN.c, r: S.SPAWN.r }));
  // each bot builds a wall row leaving a gap -> maze
  const t0 = Date.now();
  let tick = 0;
  while (Date.now() - t0 < SECS * 1000) {
    tick++;
    for (const b of bots) {
      const st = b.state; if (!st) continue;
      const me = st.players.find((p) => p.id === b.id);
      if (st.phase !== 'game') continue;
      // build: rows 3,7,11,15 alternating gaps
      const row = 3 + 4 * ((b.i + tick) % 4);
      const gapLeft = (row / 4) % 2 === 0;
      const types = ['arrow', 'cannon', 'frost'];
      const type = types[(tick + b.i) % 3];
      if (me.gold >= S.TOWERS[type].cost + 20) {
        const order = [...Array(S.COLS).keys()].sort((x, y) => Math.abs(x - 5) - Math.abs(y - 5));
        for (const c of order) {
          if ((gapLeft && c === 0) || (!gapLeft && c === S.COLS - 1)) continue;
          const board = st.boards[me.team];
          if (board.towers.some((t) => t[1] === c && t[2] === row)) continue;
          b.ws.send(JSON.stringify({ t: 'build', type, c, r: row })); built++;
          break;
        }
      }
      // upgrade own towers sometimes
      const mine = st.boards[me.team].towers.filter((t) => t[5] === b.id && t[4] < 2);
      if (mine.length && me.gold > 150) b.ws.send(JSON.stringify({ t: 'upgrade', c: mine[0][1], r: mine[0][2] }));
      // send creeps
      const kinds = Object.keys(S.SENDS);
      const k = kinds[(tick + b.i) % 3];
      if (me.gold >= S.SENDS[k].cost && Math.random() < 0.5) { b.ws.send(JSON.stringify({ t: 'send', kind: k })); sendsOk++; }
      b.ws.send(JSON.stringify({ t: 'cursor', b: me.team, c: Math.random() * 11, r: Math.random() * 20 }));
    }
    // try a sell once
    if (tick === 20) { const st = host.state; const me = st.players.find((p) => p.id === host.id); const t = st.boards[me.team].towers.find((t) => t[5] === host.id); if (t) host.ws.send(JSON.stringify({ t: 'sell', c: t[1], r: t[2] })); }
    if (lastState && lastState.phase === 'over') break;
    await sleep(250);
  }
  await sleep(300);
  const st = lastState;
  console.log(`states received: ${states}, sim time: ${st.time}s, wave: ${st.wave}, phase: ${st.phase}, winner: ${st.winner}`);
  console.log(`lives L=${st.boards.L.lives} R=${st.boards.R.lives}, towers L=${st.boards.L.towers.length} R=${st.boards.R.towers.length}, max creeps seen: ${maxCreeps}`);
  console.log('players:', st.players.map((p) => `${p.name}(${p.team}) gold=${p.gold} inc=${p.income} kills=${p.kills} sent=${p.sent}`).join(' | '));
  const errCounts = {}; for (const e of errors) { const k = e.replace(/^bot\d+: /, ''); errCounts[k] = (errCounts[k] || 0) + 1; }
  console.log('server-rejected actions (expected some):', JSON.stringify(errCounts));
  const ok = states > 10 && st.time > 1 && st.players.every((p) => p.sent > 0) && (st.boards.L.towers.length + st.boards.R.towers.length) > 0 && maxCreeps > 0;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  for (const b of bots) b.ws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
