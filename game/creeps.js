// Forge TD creep movement along the board's BFS distance field, and leaking into the base.
const S = require('../public/shared.js');
const { DT } = require('./core.js');

function moveCreeps(g, b) {
  const team = b.team;
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
    if (leaked && !cr.leak) { /* a shard that carries no share of its Splitter's leak: gone, no lives, no event */ }
    else if (leaked) {
      b.rawLives -= cr.leak;
      b.lives = Math.max(0, b.lives - cr.leak);
      b.leakFlash = 0.5;
      g.events.push({ k: 'leak', team, n: cr.leak });
    } else survivors.push(cr);
  }
  b.creeps = survivors;
  if (b.leakFlash > 0) b.leakFlash -= DT;
}

module.exports = { moveCreeps };
