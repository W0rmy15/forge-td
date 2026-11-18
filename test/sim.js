// In-process checks for v0.3/v0.4 game rules (no server needed): queued sales, send scaling, sudden-death finish rule.
// Usage: node test/sim.js
const S = require('../public/shared.js');
const G = require('../game.js');
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
function mkRoom(n = 1) {
  const room = { code: 'T', players: new Map(), phase: 'game' };
  let id = 1;
  for (const team of ['L', 'R']) for (let i = 0; i < n; i++) { room.players.set(id, { id, team, name: team + id, kills: 0, sent: 0 }); id++; }
  G.createGame(room); return room;
}
const step = (room, sec) => { for (let i = 0; i < sec / G.DT && room.phase === 'game'; i++) { G.stepGame(room); room.game.events.length = 0; } };

// --- queued sales ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L;
  p.gold = 10000;
  check('build arrow', G.build(room, p, 'arrow', 2, 5) === null);
  check('board idle before wave 1 -> sale is immediate', G.sell(room, p, 2, 5) === null && !b.towers.has('2,5'));
  G.build(room, p, 'arrow', 2, 5); G.build(room, p, 'arrow', 3, 5);
  step(room, S.FIRST_WAVE + 1); // wave 1 spawning
  for (const c of b.creeps) { c.hp = c.maxHp = 5000; } for (const q of b.queue) q.hp = 5000; // tough enough to keep the board busy
  check('board busy during wave', G.boardBusy(g, b) === true, { creeps: b.creeps.length, queued: b.queue.length });
  const gold0 = p.gold;
  check('sell on busy board queues (tower stays)', G.sell(room, p, 2, 5) === null && b.towers.has('2,5') && b.towers.get('2,5').sellAt !== null);
  check('no refund while queued', p.gold === gold0);
  check('queued tower cannot be upgraded', /queued for sale/.test(G.upgrade(room, p, 2, 5) || ''));
  const t = b.towers.get('2,5'); const cd0 = t.cd; let fired = false;
  for (let i = 0; i < 100 && b.towers.has('2,5'); i++) { G.stepGame(room); if (room.game.events.some((e) => e.k === 'shot' && e.x1 === 2.5 && e.y1 === 5.5)) fired = true; room.game.events.length = 0; }
  check('queued tower keeps firing', fired);
  check('sell again cancels the queued sale', G.sell(room, p, 2, 5) === null && b.towers.get('2,5').sellAt === null);
  G.sell(room, p, 2, 5);
  let sold = null; const ref = Math.floor(S.towerSpent('arrow', 0) * S.SELL_REFUND);
  const sellAt = b.towers.get('2,5').sellAt;
  for (let i = 0; i < 2000; i++) { const busy = G.boardBusy(g, b); G.stepGame(room); g.events.length = 0; if (!b.towers.has('2,5')) { sold = { busyBefore: busy, creeps: b.creeps.length, waited: +(g.time - sellAt).toFixed(2) }; break; } }
  check('queued sale executes once board is clear, or after the max wait with no creep near', sold && (!sold.busyBefore || sold.waited >= S.SELL_MAX_WAIT), sold);
  check('refund paid on execution (70%)', p.gold >= gold0 + ref - 1, { gold0, now: p.gold, ref });
}
// --- send HP scaling ---
{
  const r1 = mkRoom(1), r2 = mkRoom(2);
  for (const r of [r1, r2]) { r.game.wave = 12; for (const p of r.players.values()) { p.gold = 1e5; p.income = 0; } }
  G.doSend(r1, r1.players.get(1), 'runner'); G.doSend(r2, r2.players.get(1), 'runner');
  const h1 = r1.game.boards.R.queue[0].hp, h2 = r2.game.boards.R.queue[0].hp;
  const want2 = S.sendTeamMult(2, 12);
  check('2v2 send HP = sendTeamMult(2, wave) x 1v1 send HP', Math.abs(h2 / h1 - want2) < 0.02, { h1, h2, want: want2 });
  check(`runner HP = ${S.SENDS.runner.hpMult} x wave HP x ramp at wave 12`, Math.abs(h1 - S.SENDS.runner.hpMult * S.waveHp(12) * S.sendRamp(12)) <= 1, { h1, wave: S.waveHp(12), ramp: S.sendRamp(12) });
  const rf = S.sendRampFullWave();
  check(`send ramp: wave 1 = ${S.SEND_RAMP.START + S.SEND_RAMP.PER_WAVE}x, wave ${rf}+ = 1x`, Math.abs(S.sendRamp(1) - S.SEND_RAMP.START - S.SEND_RAMP.PER_WAVE) < 1e-9 && S.sendRamp(rf - 1) < 1 && S.sendRamp(rf) === 1 && S.sendRamp(rf + 6) === 1);
  check('bounties Runner 9 / Swarm 3 / Brute 24', S.SENDS.runner.bounty === 9 && S.SENDS.swarm.bounty === 3 && S.SENDS.brute.bounty === 24);
  const tw = S.TEAM2_SCALE_WAVE;
  check(`2v2 team scale eases 2.0 (wave 1) -> 2.3 (wave ${tw}+), 1v1 = 1`, S.teamScale(1, 12) === 1 && Math.abs(S.teamScale(2, 1) - 2.0) < 1e-9 && Math.abs(S.teamScale(2, tw) - 2.3) < 1e-9 && Math.abs(S.teamScale(2, tw + 16) - 2.3) < 1e-9);
  const T2 = S.SEND_TEAM2;
  check(`2v2 send multiplier: x${T2.START} to wave ${T2.FROM}, x2.99 (2.3 x 1.3) from wave ${T2.FULL}, 1v1 = 1`, S.sendTeamMult(1, 20) === 1 && S.sendTeamMult(2, 1) === T2.START && S.sendTeamMult(2, T2.FROM) === T2.START && Math.abs(S.sendTeamMult(2, T2.FULL) - 2.99) < 1e-9 && Math.abs(S.sendTeamMult(2, T2.FULL + 14) - 2.99) < 1e-9);
  check('send HP multipliers 1.9 (v0.6, was 2.1) / 0.9 / 10.5 (QA T10)', S.SENDS.runner.hpMult === 1.9 && S.SENDS.swarm.hpMult === 0.9 && S.SENDS.brute.hpMult === 10.5);
}
// --- unlimited sends + send lane ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e5; g.wave = 5;
  let errs = 0; for (let i = 0; i < 40; i++) if (G.doSend(room, p, 'runner')) errs++;
  const q = g.boards.R.queue.filter((x) => x.from).map((x) => x.at).sort((a, b) => a - b);
  check('40 runner sends in one wave all accepted (no per-wave cap; 24 s of lane)', errs === 0 && q.length === 40, { errs, n: q.length });
  check('sends enter through the lane, spaced lane x mult apart', Math.abs(q[1] - q[0] - S.SENDS.runner.lane * S.SEND_LANE_MULT) < 1e-9, { gap: q[1] - q[0] });
}
// --- v0.4: lane limit (server protection, not a per-wave cap) ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = 5;
  let n = 0, err = null; for (let i = 0; i < 500 && !err; i++) { err = G.doSend(room, p, 'brute'); if (!err) n++; }
  const b = g.boards.R, ahead = b.sendAt - g.time, gold = p.gold;
  check('sends refused with "Lane full" once the lane is booked > 45 s ahead', /Lane full/.test(err || '') && ahead > S.LANE_MAX_AHEAD && ahead - S.SENDS.brute.lane * S.SEND_LANE_MULT <= S.LANE_MAX_AHEAD, { n, err, ahead });
  check('refused send is not charged', G.doSend(room, p, 'runner') && p.gold === gold);
  step(room, 10);
  check('lane frees up as time passes', G.doSend(room, p, 'runner') === null);
}
// --- v0.4: sudden-death multipliers are applied at spawn, not at send ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6;
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE - 1; g.boards.R.sendAt = g.time + 40; // lane booked: this send enters after sudden death starts
  G.doSend(room, p, 'runner'); const qe = g.boards.R.queue.find((x) => x.from);
  check('queued send HP has no sudden-death multiplier at send time', qe.hp === S.sendHp('runner', g.wave, 1, 0), { hp: qe.hp });
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE + 1; g.time = qe.at; g.nextWave = 1e9; g.boards.R.queue = [qe];
  G.stepGame(room);
  const cr = g.boards.R.creeps.find((c) => c.from);
  const mult = Math.pow(S.WAVE.SUDDEN_DEATH_GROWTH, 2);
  check('sudden-death HP + leak multipliers applied when the creep spawns', cr && Math.abs(cr.maxHp - Math.round(qe.hp * mult)) <= 1 && cr.leak === qe.leak * S.WAVE.SUDDEN_DEATH_LEAK_MULT, cr && { hp: cr.maxHp, want: Math.round(qe.hp * mult), leak: cr.leak });
}
// --- v0.4: queued sale max wait ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e5;
  G.build(room, p, 'arrow', 10, 18); // far corner, nowhere near the path
  b.queue.push({ at: 1e9, kind: 'neutral', hp: 1, speed: 1, bounty: 1, leak: 1, radius: 0.3 });
  b.creeps.push({ id: 999, kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 0, leak: 1, radius: 0.3, v: 1, arrowMult: 1, slowResist: 0, c: 5, r: 2, nc: null, nr: null, x: 5.5, y: 2.5, slowUntil: 0, slowAmt: 0, from: null });
  g.nextWave = 1e9;
  G.sell(room, p, 10, 18);
  step(room, S.SELL_MAX_WAIT - 1);
  check('queued sale still waiting before the max wait', b.towers.has('10,18'));
  step(room, 1.5);
  check('queued sale executes after SELL_MAX_WAIT s when it reroutes nobody (board still busy)', !b.towers.has('10,18') && b.creeps.length > 0);
  // v0.5: a tower right next to a creep that is not on any route still sells after the max wait
  G.build(room, p, 'arrow', 6, 2); G.sell(room, p, 6, 2); step(room, S.SELL_MAX_WAIT + 0.5);
  check('v0.5: queued sale next to a creep sells after the max wait when no route changes', !b.towers.has('6,2'));
}
// --- v0.5: sale fallback vs routes (trickle grief) ---
{
  // a wall across row 10 with the gap at column 0; the creep stuck at (2,4) routes through the gap
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e6; g.nextWave = 1e9;
  for (let c = 1; c <= 10; c++) G.build(room, p, 'arrow', c, 10);
  b.queue.push({ at: 1e9, kind: 'neutral', hp: 1, speed: 1, bounty: 1, leak: 1, radius: 0.3 });
  b.creeps.push({ id: 998, kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 0, leak: 1, radius: 0.3, v: 1, arrowMult: 1, slowResist: 0, c: 2, r: 4, nc: null, nr: null, x: 2.5, y: 4.5, slowUntil: 0, slowAmt: 0, from: null });
  check('removing the wall tower at (5,10) changes the creep route', G.saleChangesRoute(b, b.towers.get('5,10')) === true);
  check('removing the far wall end (10,10) (a longer detour) changes no route', G.saleChangesRoute(b, b.towers.get('10,10')) === false);
  G.sell(room, p, 5, 10); const t0 = g.time;
  step(room, S.SELL_MAX_WAIT + 1);
  check('route-changing sale is still queued after SELL_MAX_WAIT', b.towers.has('5,10'));
  let soldAt = null; for (let i = 0; i < 20 * 15 && soldAt === null; i++) { G.stepGame(room); g.events.length = 0; if (!b.towers.has('5,10')) soldAt = g.time - t0; }
  check(`route-changing sale executes at the SELL_HARD_CAP (${S.SELL_HARD_CAP} s)`, soldAt !== null && Math.abs(soldAt - S.SELL_HARD_CAP) < 0.11, { soldAt });
}
// --- v0.5: QA trickle scenario (one runner per second forever: the board is never clear) ---
{
  const trickle = (tc, tr) => {
    const room = mkRoom(), g = room.game, d = room.players.get(1), a = room.players.get(2);
    d.gold = 1e5; a.gold = 1e6; g.boards.L.lives = 1e9; g.nextWave = 1e9;
    G.build(room, d, 'arrow', tc, tr);
    let queuedAt = null, soldAt = null;
    for (let i = 0; i < 20 * 120; i++) {
      if (i % 20 === 0) G.doSend(room, a, 'runner');
      if (i === 100) { G.sell(room, d, tc, tr); queuedAt = g.time; }
      for (const c of g.boards.L.creeps) c.hp = Math.max(c.hp, 1e6);
      G.stepGame(room); g.events.length = 0;
      if (queuedAt !== null && soldAt === null && !g.boards.L.towers.has(tc + ',' + tr)) soldAt = g.time - queuedAt;
    }
    return soldAt;
  };
  const near = trickle(4, 3), far = trickle(0, 18);
  check('trickle: tower beside the path sells within the hard cap', near !== null && near <= S.SELL_HARD_CAP + 0.1, { near });
  check('trickle: far tower sells after the max wait', far !== null && far <= S.SELL_MAX_WAIT + 0.1, { far });
}
// --- v0.5.1: 2v2 send income x SEND_TEAM2_INCOME, bounty x the 2v2 send HP multiplier; 1v1 unchanged ---
{
  for (const n of [1, 2]) {
    const room = mkRoom(n), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = 10;
    const inc0 = p.income + p.incomeFrac; G.doSend(room, p, 'runner');
    const q = g.boards.R.queue.filter((x) => x.from).pop(), spec = S.sendSpec('runner', 0);
    const wantInc = spec.income * (n >= 2 ? S.SEND_TEAM2_INCOME : 1), wantB = Math.round(spec.bounty * (n >= 2 ? S.sendTeamMult(2, 10) : 1));
    check(`${n}v${n}: send income gain ${wantInc} and bounty ${wantB}`, Math.abs(p.income + p.incomeFrac - inc0 - wantInc) < 1e-9 && q.bounty === wantB, { gain: +(p.income + p.incomeFrac - inc0).toFixed(3), bounty: q.bounty });
  }
}
// --- v0.5.2: send-tier income x SEND_TEAM2_INCOME in 2v2, unscaled in 1v1 ---
{
  for (const n of [1, 2]) {
    const room = mkRoom(n), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = S.SEND_UP.UNLOCK_WAVE[1];
    const inc0 = p.income + p.incomeFrac, cost = S.sendUpCost('brute', 0); G.upgradeSend(room, p, 'brute');
    const want = cost * S.SEND_UP.INCOME_PER_GOLD * (n >= 2 ? S.SEND_TEAM2_INCOME : 1);
    check(`${n}v${n}: send-tier income gain ${+want.toFixed(4)}`, Math.abs(p.income + p.incomeFrac - inc0 - want) < 1e-9, { gain: +(p.income + p.incomeFrac - inc0).toFixed(4) });
  }
}
// --- v0.4: send upgrades ---
{
  const UW = S.SEND_UP.UNLOCK_WAVE;
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = 1;
  check('upgrade: unknown / prototype kinds rejected', ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'neutral', 'boss', '', null, 7].every((k) => G.upgradeSend(room, p, k) === 'Unknown send'));
  check(`upgrade: locked before wave ${UW[1]}`, new RegExp('unlocks at wave ' + UW[1]).test(G.upgradeSend(room, p, 'runner') || ''));
  g.wave = UW[1]; const poor = room.players.get(2); poor.gold = 10;
  check('upgrade: not enough gold', G.upgradeSend(room, poor, 'runner') === 'Not enough gold' && poor.gold === 10);
  const g0 = p.gold, inc0 = p.income;
  check(`upgrade: tier 1 bought at wave ${UW[1]} for ${S.SEND_UP.UP_COST[1]}x base cost`, G.upgradeSend(room, p, 'runner') === null && G.tierOf(p, 'runner') === 1 && g0 - p.gold === S.sendUpCost('runner', 0) && S.sendUpCost('runner', 0) === Math.round(35 * S.SEND_UP.UP_COST[1]));
  check('upgrade: gives a little income (cost x INCOME_PER_GOLD, carried fraction)', p.income + p.incomeFrac - inc0 > 0 && Math.abs(p.income + p.incomeFrac - inc0 - S.sendUpCost('runner', 0) * S.SEND_UP.INCOME_PER_GOLD) < 1e-9, { inc0, inc: p.income, frac: p.incomeFrac });
  check(`upgrade: tier 2 locked until wave ${UW[2]}`, new RegExp('unlocks at wave ' + UW[2]).test(G.upgradeSend(room, p, 'runner') || ''));
  g.wave = UW[3]; G.upgradeSend(room, p, 'runner'); G.upgradeSend(room, p, 'runner');
  check('upgrade: max tier 3', G.tierOf(p, 'runner') === 3 && /max tier/.test(G.upgradeSend(room, p, 'runner') || ''));
  check('upgrade: tiers are per player and per kind', G.tierOf(p, 'brute') === 0 && G.tierOf(room.players.get(2), 'runner') === 0);
  check('upgrade: tier map has no prototype', Object.getPrototypeOf(p.sendTier) === null);
  p.sendTier.runner = 99; check('tierOf clamps a bad stored tier', G.tierOf(p, 'runner') === 3); p.sendTier.runner = 3;
  G.doSend(room, p, 'runner'); const q = g.boards.R.queue.filter((x) => x.from).pop();
  check('T3 runner: HP x1.85, speed x1.35, price x1.3', Math.abs(q.hp - Math.round(S.sendHp('runner', UW[3], 1, 0) * 1.85)) <= 2 && Math.abs(q.speed - S.SENDS.runner.speed * 1.35) < 1e-9 && S.sendSpec('runner', 3).cost === Math.round(35 * 1.3), { hp: q.hp, base: S.sendHp('runner', UW[3], 1, 0), speed: q.speed });
  g.wave = UW[3]; for (let i = 0; i < 3; i++) G.upgradeSend(room, p, 'swarm');
  const before = g.boards.R.queue.length; G.doSend(room, p, 'swarm');
  check(`T3 swarm sends ${S.SEND_TRAITS.swarm.count[3]} creeps`, g.boards.R.queue.length - before === S.SEND_TRAITS.swarm.count[3]);
  for (let i = 0; i < 3; i++) G.upgradeSend(room, p, 'brute');
  G.doSend(room, p, 'brute'); const bq = g.boards.R.queue.filter((x) => x.kind === 'brute').pop();
  check('T3 brute carries armor (arrow x0.5) and slow resist 50%', bq.arrowMult === 0.5 && bq.slowResist === 0.5);
  // armor and slow resist in combat
  const b = g.boards.R, t = { type: 'arrow', owner: 2 }, cr = { hp: 100, maxHp: 100, x: 1, y: 1, arrowMult: 0.5, slowResist: 0.5, slowUntil: 0, slowAmt: 0, kind: 'brute', v: 3, bounty: 1 };
  G._damage(room, b, cr, 10, t, g); check('armor halves arrow damage', cr.hp === 95, cr.hp);
  G._damage(room, b, cr, 10, { type: 'cannon', owner: 2 }, g); check('armor does not reduce cannon damage', cr.hp === 85, cr.hp);
  G._slow(g, cr, { slow: 0.4, slowDur: 2 }); check('slow resist halves the slow', Math.abs(cr.slowAmt - 0.2) < 1e-9, cr.slowAmt);
}
// --- sudden death finish rule ---
{
  const room = mkRoom(), g = room.game;
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE - 1; g.nextWave = 0.01; G.stepGame(room);
  check('sudden death starts at wave ' + S.WAVE.SUDDEN_DEATH_WAVE, g.suddenDeath && g.wave === S.WAVE.SUDDEN_DEATH_WAVE && g.events.some((e) => e.k === 'sudden'));
  g.events.length = 0;
  // L falls first but R will leak more in the same wave
  g.boards.L.lives = 1; g.boards.L.rawLives = 1; g.boards.R.lives = 3; g.boards.R.rawLives = 3;
  const mk = (b, n) => { for (let i = 0; i < n; i++) b.creeps.push({ id: 900 + i + (b === g.boards.R ? 100 : 0), kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 50, bounty: 0, leak: 1, radius: 0.2, c: 5, r: 18, nc: null, nr: null, x: 5.5, y: 18.5, slowUntil: 0, slowAmt: 0 }); };
  g.boards.L.queue = []; g.boards.R.queue = [];
  mk(g.boards.L, 2); G.stepGame(room);
  check('base falling in sudden death does not end the game at once', room.phase === 'game' && g.finishing && g.finishing.fell === 'L', g.finishing);
  const p = room.players.get(1); p.gold = 1e5;
  check('no sends while the final wave is played out', /Final wave/.test(G.doSend(room, p, 'runner') || ''));
  mk(g.boards.R, 6);
  let n = 0; while (room.phase === 'game' && n++ < 400) { G.stepGame(room); g.events.length = 0; }
  check('game ends when the wave is finished', room.phase === 'over', { n });
  check('side that lost fewer total lives wins even though its base fell first', g.winner === 'L', { winner: g.winner, reason: g.winReason, raw: [g.boards.L.rawLives, g.boards.R.rawLives] });
}
{
  const room = mkRoom(), g = room.game;
  g.wave = 5; g.boards.L.lives = 0; g.boards.L.rawLives = 0; G.stepGame(room);
  check('outside sudden death a fallen base loses immediately', room.phase === 'over' && g.winner === 'R');
}
{
  const room = mkRoom(), g = room.game;
  g.suddenDeath = true; g.wave = 23; g.boards.L.queue = []; g.boards.R.queue = [];
  g.boards.L.lives = 0; g.boards.L.rawLives = -2; g.boards.R.lives = 0; g.boards.R.rawLives = -2;
  G.stepGame(room); G.stepGame(room);
  check('identical lives lost and kills -> draw', room.phase === 'over' && g.winner === 'draw', { w: g.winner, r: g.winReason });
}
// --- v0.6: wave timer, later + harder sudden death ---
{
  const room = mkRoom(), g = room.game; let w1 = null, w2 = null;
  for (let i = 0; i < 2000 && w2 === null; i++) { G.stepGame(room); for (const e of g.events) if (e.k === 'wave') { if (e.n === 1) w1 = g.time; if (e.n === 2) w2 = g.time; } g.events.length = 0; }
  check(`wave 1 at ${S.FIRST_WAVE}s, then every ${S.WAVE_EVERY}s`, Math.abs(w1 - S.FIRST_WAVE) < 0.06 && Math.abs(w2 - w1 - S.WAVE_EVERY) < 0.06, { w1, w2 });
  const sdMin = S.waveStartSec(S.WAVE.SUDDEN_DEATH_WAVE) / 60;
  check(`sudden death starts at ${sdMin.toFixed(1)} min (target ~13-15, so games end ~14-16)`, sdMin >= 12.9 && sdMin <= 15);
  const r2 = mkRoom(), g2 = r2.game; g2.wave = S.WAVE.SUDDEN_DEATH_WAVE - 1; g2.nextWave = 0.01; G.stepGame(r2);
  const q = g2.boards.L.queue.find((x) => x.kind === 'neutral');
  const wantHp = Math.round(S.waveHp(S.WAVE.SUDDEN_DEATH_WAVE) * S.WAVE.SUDDEN_DEATH_GROWTH);
  check(`first SD wave: fast, x${S.WAVE.SUDDEN_DEATH_GROWTH} HP, leaks cost ${S.WAVE.SUDDEN_DEATH_LEAK_MULT}`, q.speed === S.WAVE.FAST_SPEED && Math.abs(q.hp - wantHp) <= 1 && q.leak === S.WAVE.SUDDEN_DEATH_LEAK_MULT, { hp: q.hp, wantHp, speed: q.speed, leak: q.leak });
}
// --- v0.6: Slag Splitter ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.R; p.gold = 1e6; g.wave = 20;
  check('splitter is a sendable kind', G.doSend(room, p, 'splitter') === null);
  const q = b.queue.find((x) => x.kind === 'splitter');
  check('splitter send carries its shard count', q && q.shards === S.SPLIT.SHARDS[0] && q.hp === S.sendHp('splitter', 20, 1, 0), q);
  g.time = q.at; g.nextWave = 1e9; G.stepGame(room); g.events.length = 0;
  const cr = b.creeps.find((c) => c.kind === 'splitter'); const R2 = room.players.get(2); R2.gold = 1e6;
  for (let i = 0; i < 40; i++) G.stepGame(room); g.events.length = 0; // walk a bit
  const t = { type: 'arrow', owner: 2, id: 99 }; const at = { c: cr.c, r: cr.r, x: cr.x, y: cr.y };
  G._damage(room, b, cr, 1e9, t, g);
  const ev = g.events.find((e) => e.k === 'split');
  check('killing a splitter emits a split event', ev && ev.n === S.SPLIT.SHARDS[0] && ev.b === 'R', ev);
  check('shards wait until the towers have fired (b.born)', b.born && b.born.length === S.SPLIT.SHARDS[0] && !b.creeps.some((c) => c.kind === 'shard'));
  G.stepGame(room);
  const sh = b.creeps.filter((c) => c.kind === 'shard');
  const wantHp = Math.round(cr.maxHp * S.SPLIT.SHARD_HP);
  check(`${S.SPLIT.SHARDS[0]} shards with ${S.SPLIT.SHARD_HP * 100}% HP each, fast, next to the parent`, sh.length === S.SPLIT.SHARDS[0] && sh.every((c) => c.maxHp === wantHp && c.speed === S.SPLIT.SHARD_SPEED && Math.hypot(c.x - at.x, c.y - at.y) < 0.6 && !c.shards && c.from === cr.from), sh.map((c) => [c.maxHp, c.speed, +c.x.toFixed(2), +c.y.toFixed(2)]));
  const n0 = g.events.length; G._damage(room, b, sh[0], 1e9, t, g);
  check('shards never split again', !g.events.slice(n0).some((e) => e.k === 'split'));
  // T3 splitter: 4 shards
  for (let i = 0; i < 3; i++) { g.wave = S.SEND_UP.UNLOCK_WAVE[i + 1]; G.upgradeSend(room, p, 'splitter'); }
  check('T3 splitter sends 4 shards', S.sendSpec('splitter', 3).shards === 4 && G.tierOf(p, 'splitter') === 3);
  // neutral split waves
  const sw = []; for (let n = 1; n <= 40; n++) if (S.isSplitWave(n)) sw.push(n);
  check('neutral Splitter waves exist and are never boss waves', sw.length >= 5 && sw.every((n) => !S.isBossWave(n)), sw);
  const r3 = mkRoom(), g3 = r3.game; g3.wave = sw[0] - 1; g3.nextWave = 0.01; G.stepGame(r3);
  const nq = g3.boards.L.queue.concat(g3.boards.L.creeps);
  check(`wave ${sw[0]} mixes in Splitters`, nq.some((x) => x.kind === 'splitter') && nq.some((x) => x.kind === 'neutral'));
}
// --- v0.6: Smelter heat ramp ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e6;
  check('build smelter', G.build(room, p, 'smelter', 4, 3) === null);
  const st = S.TOWERS.smelter.levels[0];
  const mk = (id, y) => ({ id, kind: 'brute', hp: 1e6, maxHp: 1e6, speed: 0, bounty: 1, leak: 1, radius: 0.3, v: 0, arrowMult: 1, slowResist: 0, shards: 0, c: 5, r: Math.floor(y), nc: null, nr: null, x: 5.5, y, slowUntil: 0, slowAmt: 0, from: null });
  const a = mk(9001, 3.5), c = mk(9002, 2.5); b.creeps.push(a);
  g.nextWave = 1e9; const hits = [];
  for (let i = 0; i < 80; i++) { const h0 = a.hp; G.stepGame(room); if (a.hp < h0) hits.push(+(h0 - a.hp).toFixed(2)); g.events.length = 0; }
  check(`smelter ramps x1 -> x${st.heatMax} in ${st.heatTime}s on one target`, Math.abs(hits[0] - st.dmg) < 1e-6 && Math.abs(hits[hits.length - 1] - st.dmg * st.heatMax) < 1e-6 && hits[3] > hits[1], hits.slice(0, 12));
  const tw = [...b.towers.values()][0]; a.hp = 0; b.creeps.push(c);
  const h0 = c.hp; for (let i = 0; i < 6; i++) { G.stepGame(room); g.events.length = 0; }
  check('heat resets when it switches target', tw.lock === c.id && h0 - c.hp <= st.dmg * S.heatMult(st, st.rate) * 2 + 1e-6, { lock: tw.lock, dealt: h0 - c.hp });
}
// --- v0.6: wire format for the new units ---
{
  const W = require('../wire.js');
  const { sh, ev } = W.splitEvents([{ k: 'shot', b: 'R', tt: 'smelter', x1: 4.5, y1: 3.5, x2: 5.5, y2: 4.2, h: 3 }, { k: 'shot', b: 'L', tt: 'frost', x1: 1.5, y1: 2.5, x2: 1.5, y2: 3 }, { k: 'split', b: 'L', x: 1, y: 2, n: 3 }]);
  const m = S.decodeState({ t: 's', sh, ev, boards: { L: { creeps: [[1, S.WIRE.KINDS.indexOf('splitter'), 55, 25, 10, 20, 0, 3], [2, S.WIRE.KINDS.indexOf('shard'), 55, 25, 3, 5, 0, 3]] }, R: { creeps: [] } } });
  const s0 = m.ev[0], s1 = m.ev[1];
  check('wire: smelter shot keeps board, type and heat stage', s0.b === 'R' && s0.tt === 'smelter' && s0.h === 3 && s1.b === 'L' && s1.tt === 'frost' && s1.h === 0 && m.ev[2].k === 'split', m.ev);
  check('wire: splitter / shard kinds and radius decode', m.boards.L.creeps[0][1] === 'splitter' && m.boards.L.creeps[1][1] === 'shard' && m.boards.L.creeps[1][7] === S.CREEP_RADIUS.shard, m.boards.L.creeps);
}
// --- v0.6 QA fix: killing a Splitter next to the base never costs more lives than letting it leak (QA shardtest idea) ---
{
  const CR = require('../game/creeps.js'), WV = require('../game/waves.js');
  const exitCase = (tier, sd, killAt) => {
    const room = mkRoom(), g = room.game; g.wave = sd ? S.WAVE.SUDDEN_DEATH_WAVE : 22; const p = room.players.get(2); p.gold = 1e6; p.sendTier.splitter = tier; // R sends at L
    G.doSend(room, p, 'splitter'); const b = g.boards.L; b.queue[0].at = 0; WV.spawnDue(g, b); const cr = b.creeps[0];
    cr.c = S.BASE.c; cr.r = S.BASE.r - (killAt === null ? 1 : killAt); cr.x = cr.c + 0.5; cr.y = cr.r + 0.5; cr.nc = null; cr.nr = null;
    const lives0 = b.rawLives;
    if (killAt !== null) { G._damage(room, b, cr, 1e9, { owner: 1, type: 'arrow' }, g); b.creeps = b.creeps.filter((c) => c.hp > 0); WV.flushBorn(b); } // as fireTowers does
    for (let i = 0; i < 400 && b.creeps.length; i++) CR.moveCreeps(g, b);
    return lives0 - b.rawLives;
  };
  const rows = [];
  for (const tier of [0, 3]) for (const sd of [false, true]) {
    const leak = exitCase(tier, sd, null), k1 = exitCase(tier, sd, 1), k0 = exitCase(tier, sd, 0);
    rows.push({ tier, sd, leak, killed1: k1, killed0: k0 });
  }
  check('Splitter killed 0-1 cells before the base costs exactly the lives of letting it leak (T0/T3, normal/SD)', rows.every((r) => r.killed1 === r.leak && r.killed0 === r.leak && r.leak >= 1), rows);
}
// --- v0.6 QA fix: tower fire interval equals st.rate (no dropped leftover time), NaN guards ---
{
  for (const [type, lvl] of [['arrow', 0], ['arrow', 2], ['smelter', 0], ['cannon', 0]]) {
    const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e6; g.nextWave = 1e9;
    G.build(room, p, type, 4, 3); [...b.towers.values()][0].lvl = lvl;
    b.creeps.push({ id: 7001, kind: 'brute', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 1, leak: 1, radius: 0.3, v: 0, arrowMult: 1, slowResist: 0, shards: 0, c: 5, r: 3, nc: null, nr: null, x: 5.5, y: 3.5, slowUntil: 0, slowAmt: 0, from: null });
    let shots = 0; const secs = 30;
    for (let i = 0; i < secs / G.DT; i++) { G.stepGame(room); shots += g.events.filter((e) => e.k === 'shot').length; g.events.length = 0; }
    const want = secs / S.TOWERS[type].levels[lvl].rate;
    check(`${type} L${lvl + 1} fires every ${S.TOWERS[type].levels[lvl].rate}s (${shots} shots in ${secs}s, want ~${want})`, Math.abs(shots - want) <= 1);
  }
  const st = S.TOWERS.smelter.levels[0];
  check('heatMult(NaN / -1 / Infinity) stays finite', [NaN, -1, Infinity, undefined].every((h) => Number.isFinite(S.heatMult(st, h))));
  const room = mkRoom(), g = room.game, b = g.boards.L; const cr = { id: 1, hp: 50, maxHp: 50, x: 1, y: 1, bounty: 1, kind: 'neutral', shards: 0, slowUntil: 0, arrowMult: 1 };
  G._damage(room, b, cr, NaN, { owner: 1, type: 'smelter' }, g); G._damage(room, b, cr, Infinity, { owner: 1, type: 'smelter' }, g);
  check('damage ignores NaN / Infinity', cr.hp === 50);
  const m = S.decodeState({ t: 's', sh: [1e300, 1, 1, 10, 10], ev: [], boards: { L: { creeps: [] }, R: { creeps: [] } } });
  check('decoded heat stage is clamped to 0..3', m.ev[0].h >= 0 && m.ev[0].h <= 3, m.ev[0]);
}
console.log(fails ? `SIM TESTS: ${fails} FAILED` : 'SIM TESTS: ALL PASS');
process.exit(fails ? 1 : 0);
