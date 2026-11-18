// Forge TD core helpers shared by every game/ module: tick length, cell keys, gold/income safety, board setup.
const S = require('../public/shared.js');

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

function newBoard(team) {
  return { team, lives: S.LIVES, rawLives: S.LIVES, towers: new Map(), creeps: [], queue: [], sendAt: 0, dist: S.computeDist(() => false), leakFlash: 0, towerVer: 1 };
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

module.exports = { TICK, DT, key, other, addGold, addIncome, teamSizeOf, newBoard, recomputeDist, canBuild };
