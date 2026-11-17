// Shared game constants + pathfinding (used by both server and client)
(function (root) {
  const S = {
    COLS: 11, ROWS: 20,
    SPAWN: { c: 5, r: 0 }, BASE: { c: 5, r: 19 },
    START_GOLD: 150, START_INCOME: 10, LIVES: 20,
    INCOME_EVERY: 10, WAVE_EVERY: 30, FIRST_WAVE: 20,
    MAX_PER_TEAM: 2, SELL_REFUND: 0.7,
    TOWERS: {
      arrow: { name: 'Arrow', key: '1', color: '#f2c94c', cost: 50, desc: 'Fast single target',
        levels: [ { dmg: 10, range: 3.0, rate: 0.5 }, { dmg: 22, range: 3.3, rate: 0.45 }, { dmg: 45, range: 3.7, rate: 0.4 } ] },
      cannon: { name: 'Cannon', key: '2', color: '#b0b8c4', cost: 80, desc: 'Slow, splash damage',
        levels: [ { dmg: 22, range: 2.6, rate: 1.4, splash: 1.1 }, { dmg: 48, range: 2.9, rate: 1.3, splash: 1.3 }, { dmg: 100, range: 3.2, rate: 1.2, splash: 1.5 } ] },
      frost: { name: 'Frost', key: '3', color: '#6fd3ff', cost: 60, desc: 'Slows creeps',
        levels: [ { dmg: 4, range: 2.6, rate: 0.9, slow: 0.4, slowDur: 1.5 }, { dmg: 9, range: 2.9, rate: 0.8, slow: 0.5, slowDur: 1.8 }, { dmg: 18, range: 3.2, rate: 0.7, slow: 0.6, slowDur: 2.2 } ] },
    },
    // cost to upgrade to level index i = tower.cost * UPGRADE_MULT[i]
    UPGRADE_MULT: [0, 1, 1.6],
    SENDS: {
      runner: { name: 'Runner', key: 'q', desc: 'Fast', cost: 20, income: 2, hp: 45, speed: 2.6, bounty: 3, leak: 1, count: 1, radius: 0.22, color: '#7bed6f' },
      brute: { name: 'Brute', key: 'w', desc: 'Tanky', cost: 45, income: 4, hp: 260, speed: 0.9, bounty: 6, leak: 2, count: 1, radius: 0.36, color: '#e05d5d' },
      swarm: { name: 'Swarm', key: 'e', desc: '5 small', cost: 30, income: 3, hp: 18, speed: 1.8, bounty: 1, leak: 1, count: 5, radius: 0.16, color: '#c58bff' },
    },
    NEUTRAL: { color: '#d9d9d9', bossColor: '#ff9f43' },
  };
  S.towerSpent = function (type, lvl) {
    const t = S.TOWERS[type]; let s = t.cost;
    for (let i = 1; i <= lvl; i++) s += Math.round(t.cost * S.UPGRADE_MULT[i]);
    return s;
  };
  S.upgradeCost = function (type, lvl) { // cost to go from lvl to lvl+1
    if (lvl >= 2) return null;
    return Math.round(S.TOWERS[type].cost * S.UPGRADE_MULT[lvl + 1]);
  };
  // BFS distance field from base. blocked: function(c,r)->bool. Returns Int32Array (-1 = unreachable)
  S.computeDist = function (blocked) {
    const { COLS, ROWS, BASE } = S;
    const d = new Int32Array(COLS * ROWS).fill(-1);
    const q = [BASE.c + BASE.r * COLS]; d[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], c = i % COLS, r = (i / COLS) | 0;
      const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of nb) {
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const j = nc + nr * COLS;
        if (d[j] !== -1 || blocked(nc, nr)) continue;
        d[j] = d[i] + 1; q.push(j);
      }
    }
    return d;
  };
  // pick next cell from (c,r) following distance field
  S.nextCell = function (d, c, r) {
    const { COLS, ROWS } = S;
    const cur = d[c + r * COLS];
    let best = null, bd = cur < 0 ? 1e9 : cur;
    const nb = [[c, r + 1], [c - 1, r], [c + 1, r], [c, r - 1]];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const v = d[nc + nr * COLS];
      if (v >= 0 && v < bd) { bd = v; best = { c: nc, r: nr }; }
    }
    return best;
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = S; else root.SHARED = S;
})(typeof window !== 'undefined' ? window : this);
