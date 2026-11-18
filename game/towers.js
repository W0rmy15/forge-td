// Forge TD towers: build / upgrade / sell (incl. queued sales), targeting, firing, damage and slow.
const S = require('../public/shared.js');
const { key, addGold, canBuild, recomputeDist, DT } = require('./core.js');

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
  return { t };
}

function upgrade(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  if (t.sellAt !== null) return 'That tower is queued for sale (sell again to cancel)';
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

// A board is busy while creeps are on it or a spawn is due within SELL_SPAWN_GUARD seconds.
// Sales on a busy board are queued and execute the moment it is clear, so the path can never change
// under live creeps by removing a tower (this is what stops sell/rebuild "juggling").
function boardBusy(g, b) {
  return b.creeps.length > 0 || b.queue.some((q) => q.at <= g.time + S.SELL_SPAWN_GUARD);
}

// Would removing tower t change the route of any creep on the board (or of the next spawn)?
// Routes are followed cell by cell with S.nextCell, so the route from a cell is unchanged iff every cell on it
// picks the same next cell with and without the tower. We walk the union of all current routes once.
function saleChangesRoute(b, t) {
  const tk = key(t.c, t.r);
  const nd = S.computeDist((c, r) => { const k = key(c, r); return k !== tk && b.towers.has(k); });
  const seen = new Uint8Array(S.COLS * S.ROWS);
  const starts = [[S.SPAWN.c, S.SPAWN.r]];
  for (const cr of b.creeps) starts.push(cr.nc !== null ? [cr.nc, cr.nr] : [cr.c, cr.r]);
  for (const [c0, r0] of starts) {
    let c = c0, r = r0;
    for (let guard = 0; guard < S.COLS * S.ROWS; guard++) {
      const i = c + r * S.COLS;
      if (seen[i]) break;
      seen[i] = 1;
      if (c === S.BASE.c && r === S.BASE.r) break;
      const a = S.nextCell(b.dist, c, r), n = S.nextCell(nd, c, r);
      if (!a || !n) { if (a || n) return true; break; }
      if (a.c !== n.c || a.r !== n.r) return true;
      c = a.c; r = a.r;
    }
  }
  return false;
}

// sell = sell now if the board is clear, otherwise queue the sale; selling a queued tower again cancels the sale
function sell(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  const g = room.game, b = g.boards[p.team];
  if (t.sellAt !== null) { t.sellAt = null; b.towerVer++; return null; }
  if (boardBusy(g, b)) { t.sellAt = g.time; b.towerVer++; }
  else finishSell(room, b, t);
  return null;
}

function damage(room, b, cr, dmg, tower, g) {
  if (cr.hp <= 0) return;
  if (g.time < cr.slowUntil) dmg *= S.SLOWED_DMG_MULT;
  if (tower.type === 'arrow' && cr.arrowMult !== 1) dmg *= cr.arrowMult; // armored Brutes
  cr.hp -= dmg;
  if (cr.hp <= 0) {
    const owner = room.players.get(tower.owner);
    if (owner) { addGold(owner, cr.bounty); owner.kills++; }
    tower.kills = (tower.kills || 0) + 1;
    g.events.push({ k: 'kill', b: b.team, x: +cr.x.toFixed(2), y: +cr.y.toFixed(2), kind: cr.kind, v: cr.v, g: cr.bounty, o: tower.owner });
  }
}

function slow(g, cr, st) {
  const active = g.time < cr.slowUntil;
  const amt = st.slow * (1 - (cr.slowResist || 0));
  cr.slowAmt = active ? Math.max(amt, cr.slowAmt) : amt;
  cr.slowUntil = Math.max(cr.slowUntil, g.time + st.slowDur);
}

// queued sales: see S.SELL_MAX_WAIT / S.SELL_HARD_CAP
function processSales(room, b) {
  const g = room.game;
  // queued sells execute as soon as the board is clear; on a busy board after SELL_MAX_WAIT s if removing the tower
  // reroutes nobody, and after SELL_HARD_CAP s no matter what (so trickle sends can't lock towers in place)
  let anySell = false; for (const t of b.towers.values()) if (t.sellAt !== null) { anySell = true; break; }
  if (anySell) {
    const busy = boardBusy(g, b);
    for (const t of [...b.towers.values()]) {
      if (t.sellAt === null) continue;
      const waited = g.time - t.sellAt + 1e-9;
      if (!busy || waited >= S.SELL_HARD_CAP || (waited >= S.SELL_MAX_WAIT && !saleChangesRoute(b, t))) finishSell(room, b, t);
    }
  }
}

function fireTowers(room, b) {
  const g = room.game, team = b.team;
  // towers fire
  for (const t of b.towers.values()) {
    t.cd -= DT; // towers queued for sale keep firing until the sale executes
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

module.exports = { build, upgrade, sell, finishSell, boardBusy, saleChangesRoute, damage, slow, processSales, fireTowers };
