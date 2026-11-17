// In-process balance simulator (no networking): runs full matches at thousands x real speed
// with strategy bots ported from the QA reviewer's bot (serpentine maze, build/upgrade, send a fraction of spend).
// Usage: node test/balance.js [seeds=3]
const S = require('../public/shared.js');
const G = require('../game.js');

const ORDER = [];
[2, 5, 8, 11, 14, 17].forEach((r, wi) => {
  const gapLeft = wi % 2 === 0; const cols = [...Array(11).keys()].filter((c) => (gapLeft ? c !== 0 : c !== 10));
  cols.sort((a, b) => Math.abs(a - 5) - Math.abs(b - 5) || a - b);
  for (const c of cols) ORDER.push([c, r]);
});

// strat: {tower:'arrow'|'cannon'|'frost'|'mix', send:0..1, kind:'runner'|'brute'|'swarm'|'mix', need:'up'|'mid'|'wall', burst?:k,
//         up?:maxTier (buy send upgrades up to this tier), upFrac?:share of all spending reserved for upgrades (default 0.1),
//         upWave?:first wave to start upgrading}
// Spending shares: sends get `send`, upgrades `upFrac`, defense the rest. While saving for a tier the bot banks the
// upgrade share (defense may not dip into it); sends keep going from their own share.
function botAct(room, p, strat, rng) {
  const g = room.game, B = g.boards[p.team];
  const kinds = strat.kind === 'mix' ? ['runner', 'swarm', 'brute'] : [strat.kind];
  // send upgrades: the next tier of the lowest-tier kind this bot sends; while one is wanted the bot banks its send budget for it
  if (strat.up && strat.send > 0 && g.wave >= (strat.upWave || 4)) {
    const k = kinds.slice().sort((a, b) => G.tierOf(p, a) - G.tierOf(p, b))[0];
    const t = G.tierOf(p, k), cost = t < strat.up && g.wave >= S.SEND_UP.UNLOCK_WAVE[t + 1] ? S.sendUpCost(k, t) : null;
    const uf = strat.upFrac || 0.1;
    if (cost !== null) {
      const total = p._def + p._send + (p._up || 0);
      if (p.gold >= cost && (p._up || 0) + cost <= uf * (total + cost) + 1e-9) { if (!G.upgradeSend(room, p, k)) p._up = (p._up || 0) + cost; }
      p._saving = G.tierOf(p, k) === t ? uf : 0; // still wanted: defense must leave the upgrade share banked
    } else p._saving = 0;
  } else p._saving = 0;
  // burst: k -> bank the send budget and dump it all on every k-th wave (tests unlimited sends per wave)
  const sendNow = !strat.burst || (g.wave > 0 && g.wave % strat.burst === 0 && g.nextWave > S.WAVE_EVERY - 6);
  for (let guard = 0; guard < (strat.burst ? 200 : 5) && strat.send > 0 && sendNow; guard++) {
    const k = kinds[p._kidx % kinds.length], cost = S.sendSpec(k, G.tierOf(p, k)).cost, total = p._def + p._send + (p._up || 0);
    if (p.gold >= cost && p._send + cost <= strat.send * (total + cost) + 1e-9) {
      if (G.doSend(room, p, k)) break; p._send += cost; p._kidx++;
    } else break;
  }
  for (let guard = 0; guard < 4; guard++) {
    const mine = [...B.towers.values()].filter((t) => t.owner === p.id && t.sellAt === null);
    const need = Math.min(ORDER.length, strat.need === 'up' ? 4 + g.wave : strat.need === 'wall' ? 6 + 3 * g.wave : 5 + 2 * g.wave);
    const types = strat.tower === 'mix' ? ['arrow', 'arrow', 'cannon', 'frost'] : [strat.tower];
    const type = types[p._tidx % types.length];
    const cands = ORDER.filter(([c, r]) => !B.towers.has(c + ',' + r) && !p._failed.has(c + ',' + r));
    const wantBuild = cands.length && (B.towers.size < need || mine.every((t) => t.lvl === 2));
    // burst bots bank their send share: defense may only use (1 - send) of everything earned so far
    // upgraders bank the same way while saving for a tier, so defense keeps exactly its (1 - send) share
    const defOk = (cost) => !(strat.burst || p._saving) || p._def + cost <= (1 - strat.send - (p._saving || 0)) * (p._def + p._send + (p._up || 0) + p.gold);
    if (wantBuild) {
      if (p.gold < S.TOWERS[type].cost || !defOk(S.TOWERS[type].cost)) break;
      let ok = false;
      for (const [c, r] of cands.slice(0, 6)) { // a creep may be in the way: try the next few maze cells
        const err = G.build(room, p, type, c, r);
        if (!err) { ok = true; break; }
        if (/block/.test(err)) p._failed.add(c + ',' + r);
      }
      if (!ok) break;
      p._def += S.TOWERS[type].cost; p._tidx++;
    } else {
      const up = mine.filter((t) => t.lvl < 2).sort((a, b) => a.lvl - b.lvl)[0];
      if (!up) break; const cost = S.upgradeCost(up.type, up.lvl);
      if (p.gold < cost || !defOk(cost)) break;
      G.upgrade(room, p, up.c, up.r); p._def += cost;
    }
  }
}

function run(label, stratsL, stratsR, opts = {}) {
  const room = { code: 'SIM', players: new Map(), phase: 'game' };
  let id = 1; const strat = new Map();
  for (const [team, list] of [['L', stratsL], ['R', stratsR]]) for (const s of list) {
    const p = { id: id++, team, name: team + id, kills: 0, sent: 0, _kidx: 0, _tidx: 0, _def: 0, _send: 0, _failed: new Set() };
    room.players.set(p.id, p); strat.set(p.id, s);
  }
  G.createGame(room);
  const g = room.game; const maxT = (opts.maxMin || 40) * 60;
  // seeded jitter: each bot reacts every 3-8 ticks (0.15-0.4 s), like a network client with variable latency
  let seed = (opts.seed || 1) * 2654435761 >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const nextAct = new Map([...room.players.keys()].map((id) => [id, 1 + Math.floor(rnd() * 6)]));
  let ticks = 0;
  while (room.phase === 'game' && g.time < maxT) {
    ticks++;
    for (const p of room.players.values()) if (ticks >= nextAct.get(p.id)) { botAct(room, p, strat.get(p.id)); nextAct.set(p.id, ticks + 3 + Math.floor(rnd() * 6)); }
    G.stepGame(room);
    if (opts.onEvent) for (const e of g.events) opts.onEvent(e, g);
    g.events.length = 0;
  }
  const players = [...room.players.values()];
  return { label, winner: g.winner || 'timeout', reason: g.winReason, min: +(g.time / 60).toFixed(1), wave: g.wave, lives: [g.boards.L.lives, g.boards.R.lives],
    inc: players.map((p) => p.team + p.income).join(' '), sent: players.map((p) => p.sent).join('/'),
    tiers: players.map((p) => Object.values(p.sendTier || {}).join('')).join('/') };
}
module.exports = { run, ORDER };

if (require.main === module) {
  const N = parseInt(process.argv[2] || '5', 10);
  const D = (t = 'mix', need = 'mid') => ({ tower: t, send: 0, kind: 'mix', need });
  const E = (f, k = 'mix', t = 'mix') => ({ tower: t, send: f, kind: k, need: 'mid' });
  // U(f): same total non-defense share f as E(f), split 65% sends / 35% send upgrades
  const U = (f, k = 'mix', upWave = 5) => ({ tower: 'mix', send: +(f * 0.65).toFixed(3), kind: k, need: 'mid', up: 3, upFrac: +(f * 0.35).toFixed(3), upWave });
  const sets = [
    ['1v1 D(mix) vs D(mix)', [D()], [D()]],
    ['1v1 D(arrow) vs D(mix)', [D('arrow')], [D()]],
    ['1v1 arrow vs cannon', [D('arrow')], [D('cannon')]],
    ['1v1 frost vs mix', [D('frost')], [D()]],
    ['1v1 upgrade-first vs wall-first (arrow)', [D('arrow', 'up')], [D('arrow', 'wall')]],
    ['1v1 E20 vs D', [E(0.2)], [D()]],
    ['1v1 E40 vs D', [E(0.4)], [D()]],
    ['1v1 E60 vs D', [E(0.6)], [D()]],
    ['1v1 E40 vs E20', [E(0.4)], [E(0.2)]],
    ['1v1 brute20 vs runner20', [E(0.2, 'brute')], [E(0.2, 'runner')]],
    ['1v1 brute20 vs swarm20', [E(0.2, 'brute')], [E(0.2, 'swarm')]],
    ['1v1 runner20 vs swarm20', [E(0.2, 'runner')], [E(0.2, 'swarm')]],
    ['2v2 D vs D', [D(), D('arrow')], [D(), D('arrow')]],
    ['2v2 E20 vs D', [E(0.2), E(0.2)], [D(), D('arrow')]],
    ['2v2 E40 vs D', [E(0.4), E(0.4)], [D(), D('arrow')]],
    ['2v2 E20 vs E20', [E(0.2), E(0.2)], [E(0.2), E(0.2)]],
    ['2v2 E40 vs E20', [E(0.4), E(0.4)], [E(0.2), E(0.2)]],
    // v0.4: bots that buy send upgrades (U = upgrader: banks its send budget for the next tier)
    ['1v1 U20 vs D', [U(0.2)], [D()]],
    ['1v1 U40 vs D', [U(0.4)], [D()]],
    ['1v1 U60 vs D', [U(0.6)], [D()]],
    ['1v1 U20 vs E20', [U(0.2)], [E(0.2)]],
    ['1v1 U40 vs E20', [U(0.4)], [E(0.2)]],
    ['1v1 U20 vs U20', [U(0.2)], [U(0.2)]],
    ['1v1 U40brute vs D', [U(0.4, 'brute')], [D()]],
    ['1v1 U40brute vs D(arrow)', [U(0.4, 'brute')], [D('arrow')]],
    ['1v1 U40runner vs D', [U(0.4, 'runner')], [D()]],
    ['1v1 U40swarm vs D', [U(0.4, 'swarm')], [D()]],
    ['2v2 U20 vs D', [U(0.2), U(0.2)], [D(), D('arrow')]],
    ['2v2 U40 vs D', [U(0.4), U(0.4)], [D(), D('arrow')]],
    ['2v2 U60 vs D', [U(0.6), U(0.6)], [D(), D('arrow')]],
    ['2v2 U20 vs E20', [U(0.2), U(0.2)], [E(0.2), E(0.2)]],
    ['2v2 U40 vs E20', [U(0.4), U(0.4)], [E(0.2), E(0.2)]],
    ['2v2 U20 vs U20', [U(0.2), U(0.2)], [U(0.2), U(0.2)]],
  ];
  console.log(`${N} seeds per matchup; minutes are simulated game time (= real time at SPEED=1)`);
  for (const [l, a, b] of sets) {
    const rs = []; for (let i = 1; i <= N; i++) rs.push(run(l, a, b, { seed: i }));
    const mins = rs.map((r) => r.min).sort((x, y) => x - y);
    const w = { L: 0, R: 0, draw: 0, timeout: 0 }; rs.forEach((r) => w[r.winner]++);
    console.log(`${l.padEnd(40)} left ${w.L} right ${w.R} draw ${w.draw}${w.timeout ? ' timeout ' + w.timeout : ''} | minutes ${mins.join(', ')} | waves ${rs.map((r) => r.wave).join(',')} | lives ${rs.map((r) => r.lives.join('/')).join(' ')}${rs[0].tiers.replace(/[0/]/g, '') ? ' | tiers ' + rs[0].tiers : ''}`);
  }
}
