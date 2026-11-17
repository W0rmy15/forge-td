// Forge TD - pure game simulation (no networking). Used by server.js and by test/balance.js.
const S = require('./public/shared.js');

const TICK = 50; // ms (20 Hz)
const DT = TICK / 1000;
const key = (c, r) => c + ',' + r;
const other = (t) => (t === 'L' ? 'R' : 'L');

// ---- gold / income safety: every change goes through these ----
function addGold(p, amt) {
  const v = p.gold + amt;
  if (!Number.isFinite(amt) || !Number.isFinite(v)) throw new Error(`non-finite gold change for player ${p.id}: ${p.gold} + ${amt}`);
  p.gold = Math.max(0, Math.min(S.MAX_GOLD, v));
}
function addIncome(p, amt) {
  const v = p.income + amt;
  if (!Number.isFinite(amt) || !Number.isFinite(v)) throw new Error(`non-finite income change for player ${p.id}: ${p.income} + ${amt}`);
  p.income = Math.max(0, Math.min(S.MAX_INCOME, v));
}

function teamSizeOf(room) {
  let l = 0, r = 0;
  for (const p of room.players.values()) { if (p.team === 'L') l++; else if (p.team === 'R') r++; }
  return Math.max(1, l, r);
}

function newBoard() {
  return { lives: S.LIVES, rawLives: S.LIVES, towers: new Map(), creeps: [], queue: [], dist: S.computeDist(() => false), leakFlash: 0, towerVer: 1 };
}

function createGame(room) {
  room.game = {
    time: 0, boards: { L: newBoard(), R: newBoard() }, nextIncome: S.INCOME_EVERY, nextWave: S.FIRST_WAVE, wave: 0,
    events: [], winner: null, winReason: null, nextCreepId: 1, nextTowerId: 1, teamSize: teamSizeOf(room), suddenDeath: false,
  };
  for (const p of room.players.values()) { p.gold = S.START_GOLD; p.income = S.START_INCOME; p.sent = 0; p.kills = 0; p.ready = false; p.sendsThisWave = 0; p.sendIncome = 0; p.incomeFrac = 0; }
}

function recomputeDist(b) { b.dist = S.computeDist((c, r) => b.towers.has(key(c, r))); b.towerVer++; }

function canBuild(b, c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= S.COLS || r >= S.ROWS) return 'Out of bounds';
  if ((c === S.SPAWN.c && r === S.SPAWN.r) || (c === S.BASE.c && r === S.BASE.r)) return 'Cannot build on spawn/base';
  if (b.towers.has(key(c, r))) return 'Occupied';
  for (const cr of b.creeps) {
    if ((cr.c === c && cr.r === r) || (cr.nc === c && cr.nr === r)) return 'A creep is in the way';
  }
  const d = S.computeDist((cc, rr) => (cc === c && rr === r) || b.towers.has(key(cc, rr)));
  if (d[S.SPAWN.c + S.SPAWN.r * S.COLS] < 0) return 'That would block the path!';
  for (const cr of b.creeps) if (d[cr.c + cr.r * S.COLS] < 0) return 'That would trap a creep';
  return null;
}

function spawnCreep(g, b, spec) {
  b.creeps.push({
    id: g.nextCreepId++, kind: spec.kind, hp: spec.hp, maxHp: spec.hp, speed: spec.speed, bounty: spec.bounty, leak: spec.leak, radius: spec.radius,
    c: S.SPAWN.c, r: S.SPAWN.r, nc: null, nr: null, x: S.SPAWN.c + 0.5, y: S.SPAWN.r + 0.5, slowUntil: 0, slowAmt: 0, from: spec.from || null,
  });
}

function queueWave(room) {
  const g = room.game, W = S.WAVE;
  g.wave++;
  const n = g.wave;
  const boss = n % W.BOSS_EVERY === 0;
  const sd = n >= W.SUDDEN_DEATH_WAVE;
  if (sd && !g.suddenDeath) { g.suddenDeath = true; g.events.push({ k: 'sudden' }); }
  const sdMult = sd ? Math.pow(W.SUDDEN_DEATH_GROWTH, n - W.SUDDEN_DEATH_WAVE + 1) : 1;
  const leakMult = sd ? W.SUDDEN_DEATH_LEAK_MULT : 1;
  const hp = Math.round(S.waveHp(n) * S.teamScale(g.teamSize) * sdMult);
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const count = Math.min(W.COUNT_BASE + n, W.COUNT_MAX);
    for (let i = 0; i < count; i++) b.queue.push({ at: g.time + i * W.SPACING, kind: 'neutral', hp, speed: n % W.FAST_EVERY === 0 ? W.FAST_SPEED : W.SPEED, bounty: 1 + Math.floor(n / 3), leak: leakMult, radius: 0.24 });
    if (boss) b.queue.push({ at: g.time + count * W.SPACING + 0.5, kind: 'boss', hp: Math.round(hp * W.BOSS_HP_MULT), speed: W.BOSS_SPEED, bounty: 10 + n * 2, leak: W.BOSS_LEAK * leakMult, radius: 0.42 });
  }
  for (const p of room.players.values()) p.sendsThisWave = 0;
  g.events.push({ k: 'wave', n, boss });
}

function doSend(room, p, kind) {
  const g = room.game;
  if (!S.hasSend(kind)) return 'Unknown send';
  const spec = S.SENDS[kind];
  if (p.sendsThisWave >= S.SEND_CAP_PER_WAVE) return `Send limit reached (${S.SEND_CAP_PER_WAVE} per wave)`;
  if (p.gold < spec.cost) return 'Not enough gold';
  addGold(p, -spec.cost); p.sent++; p.sendsThisWave++;
  // diminishing returns: the more income you already got from sends, the less each new send adds
  const gain = spec.income * S.SEND_INCOME_FALLOFF / (S.SEND_INCOME_FALLOFF + p.sendIncome) + p.incomeFrac;
  const whole = Math.floor(gain);
  p.incomeFrac = gain - whole; p.sendIncome += whole;
  addIncome(p, whole);
  const b = g.boards[other(p.team)];
  const hp = S.sendHp(kind, g.wave);
  const last = b.queue.reduce((m, q) => Math.max(m, q.at), g.time);
  const start = Math.max(g.time, Math.min(last, g.time + 3)); // don't wait too long behind waves
  for (let i = 0; i < spec.count; i++) {
    b.queue.push({ at: start + i * 0.25, kind, hp, speed: spec.speed, bounty: spec.bounty, leak: spec.leak * (g.suddenDeath ? S.WAVE.SUDDEN_DEATH_LEAK_MULT : 1), radius: spec.radius, from: p.id });
  }
  g.events.push({ k: 'send', team: p.team, kind, name: p.name, id: p.id, n: p.sendsThisWave });
  return null;
}

function build(room, p, type, c, r) {
  const g = room.game, b = g.boards[p.team];
  if (!S.hasTower(type)) return 'Unknown tower';
  const err = canBuild(b, c, r);
  if (err) return err;
  const spec = S.TOWERS[type];
  if (p.gold < spec.cost) return 'Not enough gold';
  addGold(p, -spec.cost);
  b.towers.set(key(c, r), { id: g.nextTowerId++, c, r, type, lvl: 0, owner: p.id, cd: 0, sellAt: null });
  recomputeDist(b);
  return null;
}

function ownTower(room, p, c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r)) return { err: null };
  const t = room.game.boards[p.team].towers.get(key(c, r));
  if (!t) return { err: null };
  if (t.owner !== p.id) return { err: "That's your teammate's tower" };
  if (t.sellAt !== null) return { err: 'That tower is being sold' };
  return { t };
}

function upgrade(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  const cost = S.upgradeCost(t.type, t.lvl);
  if (cost === null) return 'Already max level';
  if (p.gold < cost) return 'Not enough gold';
  addGold(p, -cost); t.lvl++; room.game.boards[p.team].towerVer++;
  return null;
}

function finishSell(room, b, t) {
  const owner = room.players.get(t.owner);
  if (owner) addGold(owner, Math.floor(S.towerSpent(t.type, t.lvl) * S.SELL_REFUND));
  b.towers.delete(key(t.c, t.r));
  recomputeDist(b);
}

function sell(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  const b = room.game.boards[p.team];
  if (b.creeps.length || b.queue.some((q) => q.at <= room.game.time + S.SELL_DELAY)) { t.sellAt = room.game.time + S.SELL_DELAY; b.towerVer++; }
  else finishSell(room, b, t);
  return null;
}

function damage(room, b, cr, dmg, tower, g) {
  if (cr.hp <= 0) return;
  if (g.time < cr.slowUntil) dmg *= S.SLOWED_DMG_MULT;
  cr.hp -= dmg;
  if (cr.hp <= 0) {
    const owner = room.players.get(tower.owner);
    if (owner) { addGold(owner, cr.bounty); owner.kills++; }
    tower.kills = (tower.kills || 0) + 1;
  }
}

function slow(g, cr, st) {
  const active = g.time < cr.slowUntil;
  cr.slowAmt = active ? Math.max(st.slow, cr.slowAmt) : st.slow;
  cr.slowUntil = Math.max(cr.slowUntil, g.time + st.slowDur);
}

function stepBoard(room, team) {
  const g = room.game, b = g.boards[team];
  if (b.queue.length) {
    b.queue.sort((a, c) => a.at - c.at);
    while (b.queue.length && b.queue[0].at <= g.time) spawnCreep(g, b, b.queue.shift());
  }
  // delayed sells
  for (const t of [...b.towers.values()]) if (t.sellAt !== null && g.time >= t.sellAt) finishSell(room, b, t);
  // move creeps
  const survivors = [];
  for (const cr of b.creeps) {
    const speed = cr.speed * (g.time < cr.slowUntil ? 1 - cr.slowAmt : 1);
    let step = speed * DT;
    let leaked = false, guard = 0;
    while (step > 0 && guard++ < 10) {
      if (cr.c === S.BASE.c && cr.r === S.BASE.r) { leaked = true; break; }
      if (cr.nc === null) {
        const n = S.nextCell(b.dist, cr.c, cr.r);
        if (!n) break;
        cr.nc = n.c; cr.nr = n.r;
      }
      const tx = cr.nc + 0.5, ty = cr.nr + 0.5;
      const dx = tx - cr.x, dy = ty - cr.y, dd = Math.hypot(dx, dy);
      if (dd <= step) { cr.x = tx; cr.y = ty; step -= dd; cr.c = cr.nc; cr.r = cr.nr; cr.nc = null; cr.nr = null; }
      else { cr.x += (dx / dd) * step; cr.y += (dy / dd) * step; step = 0; }
    }
    if (leaked) {
      b.rawLives -= cr.leak;
      b.lives = Math.max(0, b.lives - cr.leak);
      b.leakFlash = 0.5;
      g.events.push({ k: 'leak', team, n: cr.leak });
    } else survivors.push(cr);
  }
  b.creeps = survivors;
  if (b.leakFlash > 0) b.leakFlash -= DT;
  // towers fire
  for (const t of b.towers.values()) {
    if (t.sellAt !== null) continue;
    t.cd -= DT;
    if (t.cd > 0) continue;
    const st = S.TOWERS[t.type].levels[t.lvl];
    const tx = t.c + 0.5, ty = t.r + 0.5;
    let target = null, best = Infinity;
    for (const cr of b.creeps) {
      if (cr.hp <= 0) continue;
      if (Math.hypot(cr.x - tx, cr.y - ty) > st.range) continue;
      const prog = b.dist[cr.c + cr.r * S.COLS];
      const score = (prog < 0 ? 999 : prog) - (cr.hp / cr.maxHp) * 0.01;
      if (score < best) { best = score; target = cr; }
    }
    if (!target) continue;
    t.cd = st.rate;
    g.events.push({ k: 'shot', b: team, tt: t.type, x1: +tx.toFixed(2), y1: +ty.toFixed(2), x2: +target.x.toFixed(2), y2: +target.y.toFixed(2) });
    if (t.type === 'cannon') {
      for (const cr of b.creeps) if (cr.hp > 0 && Math.hypot(cr.x - target.x, cr.y - target.y) <= st.splash) damage(room, b, cr, st.dmg, t, g);
      g.events.push({ k: 'boom', b: team, x: +target.x.toFixed(2), y: +target.y.toFixed(2), r: st.splash });
    } else if (t.type === 'frost') {
      damage(room, b, target, st.dmg, t, g);
      for (const cr of b.creeps) if (cr.hp > 0 && Math.hypot(cr.x - target.x, cr.y - target.y) <= st.area) slow(g, cr, st);
      g.events.push({ k: 'chill', b: team, x: +target.x.toFixed(2), y: +target.y.toFixed(2), r: st.area });
    } else damage(room, b, target, st.dmg, t, g);
  }
  b.creeps = b.creeps.filter((c) => c.hp > 0);
}

function teamKills(room, team) { let k = 0; for (const p of room.players.values()) if (p.team === team) k += p.kills; return k; }

// advances one tick; returns true if the game ended during this step
function stepGame(room) {
  const g = room.game;
  g.time += DT;
  g.nextIncome -= DT;
  if (g.nextIncome <= 0) {
    g.nextIncome += S.INCOME_EVERY;
    for (const p of room.players.values()) addGold(p, p.income);
    g.events.push({ k: 'income' });
  }
  g.nextWave -= DT;
  if (g.nextWave <= 0) { g.nextWave += S.WAVE_EVERY; queueWave(room); }
  stepBoard(room, 'L');
  stepBoard(room, 'R');
  for (const p of room.players.values()) {
    if (!Number.isFinite(p.gold) || !Number.isFinite(p.income)) throw new Error(`non-finite economy for player ${p.id}`);
  }
  const L = g.boards.L, R = g.boards.R;
  if (L.lives <= 0 || R.lives <= 0) {
    if (L.lives <= 0 && R.lives <= 0) {
      // tiebreak: fewer lives lost (overkill), then more kills, else draw
      if (L.rawLives !== R.rawLives) { g.winner = L.rawLives > R.rawLives ? 'L' : 'R'; g.winReason = 'Tiebreak: fewer lives lost'; }
      else {
        const kl = teamKills(room, 'L'), kr = teamKills(room, 'R');
        if (kl !== kr) { g.winner = kl > kr ? 'L' : 'R'; g.winReason = 'Tiebreak: more kills'; }
        else g.winner = 'draw';
      }
    } else g.winner = L.lives <= 0 ? 'R' : 'L';
    room.phase = 'over';
    return true;
  }
  return false;
}

module.exports = { TICK, DT, key, other, createGame, stepGame, build, upgrade, sell, doSend, canBuild, teamSizeOf, addGold, addIncome };
