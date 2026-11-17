// Send-vs-defense matrix (adapted from the QA reviewer's matrix.js + tune.js): sender bots spend a fraction of
// their gold on sends, defenders spend nothing on sends. Reports winner, minutes, final lives, and lives lost
// before sudden death (preSD) per side. Usage: node test/matrix.js [seeds=3] [filter]
const S = require('../public/shared.js');
const B = require('./balance.js');
const N = parseInt(process.argv[2] || '3', 10), filter = process.argv[3] || '';
const D = (t = 'mix') => ({ tower: t, send: 0, kind: 'mix', need: 'mid' });
const E = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid' });
const rows = [];
for (const k of ['mix', 'runner', 'swarm', 'brute']) for (const f of [0.2, 0.4, 0.6, 0.8]) rows.push([`1v1 ${k}${f * 100} vs D`, [E(f, k)], [D()]]);
const X = (f, k, burst) => ({ tower: 'mix', send: f, kind: k, need: 'mid', burst });
for (const k of ['mix', 'runner', 'swarm', 'brute']) for (const f of [0.3, 0.5]) for (const bu of [2, 4, 8]) {
  rows.push([`1v1 burst${bu} ${k}${f * 100} vs D`, [X(f, k, bu)], [D()]]);
  rows.push([`2v2 burst${bu} ${k}${f * 100}x2 vs Dx2`, [X(f, k, bu), X(f, k, bu)], [D(), D('arrow')]]);
}
rows.push(['1v1 E40 vs E20', [E(0.4)], [E(0.2)]], ['1v1 D vs D', [D()], [D()]]);
for (const f of [0.2, 0.4, 0.6, 0.8]) rows.push([`2v2 mix${f * 100}x2 vs Dx2`, [E(f), E(f)], [D(), D('arrow')]]);
for (const k of ['runner', 'swarm', 'brute']) for (const f of [0.4, 0.6]) rows.push([`2v2 ${k}${f * 100}x2 vs Dx2`, [E(f, k), E(f, k)], [D(), D('arrow')]]);
rows.push(['2v2 E40+D vs Dx2', [E(0.4), D()], [D(), D('arrow')]], ['2v2 E40 vs E20', [E(0.4), E(0.4)], [E(0.2), E(0.2)]], ['2v2 D vs D', [D(), D('arrow')], [D(), D('arrow')]]);
let fast = 0;
for (const [l, a, b] of rows) {
  if (filter && !l.includes(filter)) continue;
  const rs = [];
  for (let s = 1; s <= N; s++) {
    const pre = { L: 0, R: 0 };
    const r = B.run(l, a, b, { seed: s, maxMin: 25, onEvent: (e, g) => { if (e.k === 'leak' && g.wave < S.WAVE.SUDDEN_DEATH_WAVE) pre[e.team] += e.n; } });
    r.pre = pre; rs.push(r);
    if (r.winner === 'L' && r.min < 8 && a.some((x) => x.send > 0)) fast++;
  }
  const w = { L: 0, R: 0, draw: 0, timeout: 0 }; rs.forEach((r) => w[r.winner]++);
  console.log(`${l.padEnd(24)} L ${w.L} R ${w.R} d ${w.draw}${w.timeout ? ' t' + w.timeout : ''} | min ${rs.map((r) => r.min).join(',')} | lives ${rs.map((r) => r.lives.join('/')).join(' ')} | preSD lost L/R ${rs.map((r) => r.pre.L + '/' + r.pre.R).join(' ')} | inc ${rs[0].inc}`);
}
console.log(`sender wins under 8 min: ${fast}`);
