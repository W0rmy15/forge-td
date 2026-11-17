// v0.5.1 balance sweep (rows from QA's v0.5 tune5c.js + eco/burst/1v1 checks). Usage: node test/tune51.js [variant] [seeds=5]
// Variants toggle the v0.5.1 knobs in public/shared.js in place: SEND_TEAM2_INCOME / SEND_TEAM2_BOUNTY (QA fix A+B)
// and the T3 Runner speed multiplier. 'Dx2' rows are the side-swapped checks (QA: in 2v2 Left bots act first).
const S = require('../public/shared.js'); const B = require('./balance.js');
const base = { inc: S.SEND_TEAM2_INCOME, bty: S.SEND_TEAM2_BOUNTY, rs: S.SEND_TRAITS.runner.speedMult.slice() };
function apply(v) { S.SEND_TEAM2_INCOME = v.inc ?? base.inc; S.SEND_TEAM2_BOUNTY = v.bty ?? base.bty; S.SEND_TRAITS.runner.speedMult = v.rs || base.rs.slice(); }
const D = (t = 'mix') => ({ tower: t, send: 0, kind: 'mix', need: 'mid' });
const E = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid' });
const X = (f, k, burst) => ({ tower: 'mix', send: f, kind: k, need: 'mid', burst });
const U = (f, k = 'mix') => ({ tower: 'mix', send: +(f * 0.65).toFixed(3), kind: k, need: 'mid', up: 3, upFrac: +(f * 0.35).toFixed(3), upWave: 6 });
const ECO = (e) => ({ tower: 'mix', send: 0, kind: 'mix', need: 'mid', eco: e });
const EU = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid', upE: true });
const rows = [
  ['2v2 U runner60 vs D+Da', [U(0.6, 'runner'), U(0.6, 'runner')], [D(), D('arrow')]], ['2v2 U runner60 vs Dx2', [U(0.6, 'runner'), U(0.6, 'runner')], [D(), D()]],
  ['2v2 Dx2 vs U runner60', [D(), D()], [U(0.6, 'runner'), U(0.6, 'runner')]],
  ['2v2 U runner60 vs U20x2', [U(0.6, 'runner'), U(0.6, 'runner')], [U(0.2), U(0.2)]], ['2v2 U20x2 vs U runner60', [U(0.2), U(0.2)], [U(0.6, 'runner'), U(0.6, 'runner')]],
  ['2v2 U runner60 vs E20x2', [U(0.6, 'runner'), U(0.6, 'runner')], [E(0.2), E(0.2)]],
  ['2v2 U swarm60 vs D+Da', [U(0.6, 'swarm'), U(0.6, 'swarm')], [D(), D('arrow')]], ['2v2 Dx2 vs U swarm60', [D(), D()], [U(0.6, 'swarm'), U(0.6, 'swarm')]],
  ['2v2 U swarm60 vs E20x2', [U(0.6, 'swarm'), U(0.6, 'swarm')], [E(0.2), E(0.2)]], ['2v2 E20x2 vs U swarm60', [E(0.2), E(0.2)], [U(0.6, 'swarm'), U(0.6, 'swarm')]],
  ['2v2 U runner40 vs D+Da', [U(0.4, 'runner'), U(0.4, 'runner')], [D(), D('arrow')]], ['2v2 U mix40 vs E20x2', [U(0.4), U(0.4)], [E(0.2), E(0.2)]],
  ['2v2 E mix40 vs D+Da', [E(0.4), E(0.4)], [D(), D('arrow')]], ['2v2 Dx2 vs E mix40', [D(), D()], [E(0.4), E(0.4)]], ['2v2 E mix20 vs D+Da', [E(0.2), E(0.2)], [D(), D('arrow')]],
  ['2v2 E40 vs E20', [E(0.4), E(0.4)], [E(0.2), E(0.2)]], ['2v2 U20 vs E20', [U(0.2), U(0.2)], [E(0.2), E(0.2)]],
  ['2v2 burst8 brute50 vs D+Da', [X(0.5, 'brute', 8), X(0.5, 'brute', 8)], [D(), D('arrow')]], ['2v2 burst8 brute30 vs D+Da', [X(0.3, 'brute', 8), X(0.3, 'brute', 8)], [D(), D('arrow')]],
  ['2v2 ECO20 vs D+D', [ECO(0.2), ECO(0.2)], [D(), D()]], ['2v2 D vs D', [D(), D('arrow')], [D(), D('arrow')]],
  ['1v1 E40 vs D', [E(0.4)], [D()]], ['1v1 E20 vs D', [E(0.2)], [D()]], ['1v1 D vs D', [D()], [D()]], ['1v1 U mix20 vs D', [U(0.2)], [D()]],
  ['1v1 ECO20 vs D', [ECO(0.2)], [D()]], ['1v1 EU40 vs E40', [EU(0.4)], [E(0.4)]], ['1v1 U runner60 vs D', [U(0.6, 'runner')], [D()]], ['1v1 E40 vs E20', [E(0.4)], [E(0.2)]],
];
const variants = {
  V50: { inc: 1, bty: false, rs: [1, 1, 1.2, 1.35] }, // v0.5.0
  AB: { inc: 0.75, bty: true, rs: [1, 1, 1.2, 1.35] }, // QA fix A+B
  AB_r12: { inc: 0.75, bty: true, rs: [1, 1, 1.2, 1.2] }, // + T3 Runner speed 1.35 -> 1.2
};
const only = process.argv[2], N = parseInt(process.argv[3] || '5', 10);
for (const [vn, v] of Object.entries(variants)) {
  if (only && only !== 'all' && vn !== only) continue;
  apply(v); console.log('== ' + vn); let fast = 0;
  for (const [l, a, b] of rows) {
    const rs = []; for (let s = 1; s <= N; s++) rs.push(B.run(l, a, b, { seed: s, maxMin: 25 }));
    const w = { L: 0, R: 0, draw: 0, timeout: 0 }; rs.forEach((r) => (w[r.winner] = (w[r.winner] || 0) + 1));
    const senderSide = a.some((x) => x.send > 0) ? 'L' : b.some((x) => x.send > 0) ? 'R' : null;
    fast += rs.filter((r) => senderSide && r.winner === senderSide && r.min < 8).length;
    console.log(`  ${l.padEnd(28)} L${w.L} R${w.R} d${w.draw} | min ${rs.map((r) => r.min).join(',')} | lives ${rs.map((r) => r.lives.join('/')).join(' ')} | inc ${rs[0].inc}`);
  }
  console.log(`  sender wins under 8 min: ${fast}`);
}
apply({});
