// v0.5 bandwidth check: per-client state message size, v0.4 encoding vs the v0.5 compact encoding (wire.js),
// measured every tick of in-process 2v2 matches and bucketed by creeps on both boards. Usage: node test/wirebytes.js
const S = require('../public/shared.js');
const G = require('../game.js');
const W = require('../wire.js');
const B = require('./balance.js');
function players(room, team) {
  return [...room.players.values()].map((p) => { const o = { id: p.id, name: p.name, team: p.team, income: p.income, color: '#4fa3ff', cursor: null, connected: true, sent: p.sent, kills: p.kills, tiers: { runner: G.tierOf(p, 'runner'), brute: G.tierOf(p, 'brute'), swarm: G.tierOf(p, 'swarm') } }; if (p.team === team) o.gold = Math.floor(p.gold); return o; });
}
function msg(room, v05) {
  const g = room.game, boards = {};
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const o = { lives: b.lives, leak: b.leakFlash > 0 ? 1 : 0, tv: b.towerVer, busy: G.boardBusy(g, b) ? 1 : 0,
      creeps: v05 ? W.encodeCreeps(g, b) : b.creeps.map((c) => [c.id, c.kind, +c.x.toFixed(2), +c.y.toFixed(2), Math.ceil(c.hp), c.maxHp, g.time < c.slowUntil ? 1 : 0, c.radius, c.v || 0]),
      queued: b.queue.length, queuedSends: b.queue.reduce((n, q) => n + (q.from ? 1 : 0), 0) };
    if (v05) Object.assign(o, W.laneInfo(g, b));
    boards[t] = o;
  }
  const head = { t: 's', phase: room.phase, time: +g.time.toFixed(2), wave: g.wave, nextIncome: +g.nextIncome.toFixed(1), nextWave: +g.nextWave.toFixed(1), winner: g.winner, winReason: g.winReason, sd: g.suddenDeath ? 1 : 0, fin: g.finishing, teamSize: g.teamSize };
  if (v05) { const sp = W.splitEvents(g.events); return JSON.stringify({ ...head, boards, sh: sp.sh, ev: sp.ev, players: players(room, 'L') }); }
  return JSON.stringify({ ...head, boards, ev: g.events, players: players(room, 'L') });
}
const D = (t = 'mix') => ({ tower: t, send: 0, kind: 'mix', need: 'mid' });
const E = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid' });
const buckets = new Map(); let checked = 0, bad = 0;
for (const [a, b] of [[[E(0.4), E(0.4)], [D(), D('arrow')]], [[E(0.6, 'swarm'), E(0.6, 'swarm')], [D(), D()]], [[E(0.4), E(0.4)], [E(0.2), E(0.2)]]]) for (let seed = 1; seed <= 2; seed++) {
  B.run('wire', a, b, { seed, maxMin: 25, onTick: (room) => {
    const g = room.game, n = g.boards.L.creeps.length + g.boards.R.creeps.length, k = Math.min(15, Math.floor(n / 25));
    const o = msg(room, false), v = msg(room, true);
    let x = buckets.get(k); if (!x) buckets.set(k, (x = { n: 0, old: 0, neu: 0, creeps: 0, shotsOld: 0 })); x.n++; x.old += o.length; x.neu += v.length; x.creeps += n;
    x.shotsOld += g.events.filter((e) => e.k === 'shot').reduce((s, e) => s + JSON.stringify(e).length + 1, 0);
    // round trip: decoded v0.5 message matches the game within quantisation
    if (checked < 20000 && n) { checked++; const d = S.decodeState(JSON.parse(v)); const c0 = g.boards.L.creeps[0], c1 = d.boards.L.creeps[0];
      if (c0 && (!c1 || c1[0] !== c0.id || c1[1] !== c0.kind || Math.abs(c1[2] - c0.x) > 0.051 || Math.abs(c1[3] - c0.y) > 0.051 || c1[7] !== c0.radius)) bad++;
      if (d.ev.filter((e) => e.k === 'shot').length !== g.events.filter((e) => e.k === 'shot').length) bad++; }
  } });
}
console.log('creeps (both boards) | ticks | avg creeps | v0.4 bytes/msg | v0.5 bytes/msg | saved | v0.4 shot-event bytes/msg');
for (const k of [...buckets.keys()].sort((a, b) => a - b)) { const x = buckets.get(k); console.log(`${String(k * 25).padStart(3)}-${k * 25 + 24} | ${x.n} | ${(x.creeps / x.n).toFixed(0)} | ${(x.old / x.n).toFixed(0)} | ${(x.neu / x.n).toFixed(0)} | ${(100 - (100 * x.neu) / x.old).toFixed(0)}% | ${(x.shotsOld / x.n).toFixed(0)}`); }
console.log(bad ? `WIRE ROUND TRIP: ${bad} MISMATCHES` : `WIRE ROUND TRIP: OK (${checked} ticks checked)`);
process.exit(bad ? 1 : 0);
