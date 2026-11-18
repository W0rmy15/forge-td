// v0.6 balance sweep: 22 s waves, later/harder sudden death, Smelter tower and Splitter send.
// Every row is played N seeds x both seatings (mirror) and reported for the FIRST-listed team out of 2N
// (cancels the harness's Left-acts-first bias). Usage: node test/tune06.js [seeds=3] [filter]
// Reports: first-team wins/losses/draws, game minutes (min-median-max), SD start minute, and how many games ended
// within 3 min of sudden death, plus sender wins under 8 min.
const S = require('../public/shared.js'); const B = require('./balance.js');
const N = parseInt(process.argv[2] || '3', 10), filter = process.argv[3] || '';
const D = (t = 'mix') => ({ tower: t, send: 0, kind: 'mix', need: 'mid' });
const E = (f, k = 'mix', t = 'mix') => ({ tower: t, send: f, kind: k, need: 'mid' });
const U = (f, k = 'mix') => ({ tower: 'mix', send: +(f * 0.65).toFixed(3), kind: k, need: 'mid', up: 3, upFrac: +(f * 0.35).toFixed(3), upWave: 8 });
const X = (f, k, burst) => ({ tower: 'mix', send: f, kind: k, need: 'mid', burst });
const ECO = (e) => ({ tower: 'mix', send: 0, kind: 'mix', need: 'mid', eco: e });
const rows = [
  ['1v1 D vs D', [D()], [D()]],
  ['1v1 D+sm vs D', [D('mix5')], [D()]],
  ['1v1 E20 vs D', [E(0.2)], [D()]],
  ['1v1 E40 vs D', [E(0.4)], [D()]],
  ['1v1 E60 vs D', [E(0.6)], [D()]],
  ['1v1 E40 vs E20', [E(0.4)], [E(0.2)]],
  ['1v1 U20 vs D', [U(0.2)], [D()]],
  ['1v1 U40 vs D', [U(0.4)], [D()]],
  ['1v1 U60 vs D', [U(0.6)], [D()]],
  ['1v1 ECO20 vs D', [ECO(0.2)], [D()]],
  ['1v1 runner40 vs D', [E(0.4, 'runner')], [D()]],
  ['1v1 brute40 vs D', [E(0.4, 'brute')], [D()]],
  ['1v1 swarm40 vs D', [E(0.4, 'swarm')], [D()]],
  // new units: spam vs balanced
  ['1v1 smelterOnly vs D', [D('smelter')], [D()]],
  ['1v1 smelter-heavy vs D', [D('smelterHeavy')], [D()]],
  ['1v1 splitter40 vs D', [E(0.4, 'splitter')], [D()]],
  ['1v1 splitter60 vs D', [E(0.6, 'splitter')], [D()]],
  ['1v1 U splitter40 vs D', [U(0.4, 'splitter')], [D()]],
  ['1v1 splitter40 vs E40', [E(0.4, 'splitter')], [E(0.4)]],
  ['1v1 smelterOnly vs E40', [D('smelter')], [E(0.4)]],
  ['1v1 smelter-heavy E40 vs E40', [E(0.4, 'mix', 'smelterHeavy')], [E(0.4)]],
  ['1v1 E40+sm vs E40', [E(0.4, 'mix5', 'mix5')], [E(0.4)]],
  ['1v1 brute40 vs E40', [E(0.4, 'brute')], [E(0.4)]],
  ['1v1 runner40 vs E40', [E(0.4, 'runner')], [E(0.4)]],
  ['1v1 D+sm vs brute40', [D('mix5')], [E(0.4, 'brute')]],
  ['1v1 D vs brute40', [D()], [E(0.4, 'brute')]],
  ['1v1 D+sm vs splitter40', [D('mix5')], [E(0.4, 'splitter')]],
  ['1v1 burst8 brute50 vs D', [X(0.5, 'brute', 8)], [D()]],
  ['2v2 D vs D', [D(), D('arrow')], [D(), D('arrow')]],
  ['2v2 E20 vs D', [E(0.2), E(0.2)], [D(), D('arrow')]],
  ['2v2 E40 vs D', [E(0.4), E(0.4)], [D(), D('arrow')]],
  ['2v2 E40 vs E20', [E(0.4), E(0.4)], [E(0.2), E(0.2)]],
  ['2v2 U40 vs D', [U(0.4), U(0.4)], [D(), D('arrow')]],
  ['2v2 U runner60 vs D', [U(0.6, 'runner'), U(0.6, 'runner')], [D(), D('arrow')]],
  ['2v2 U swarm60 vs D', [U(0.6, 'swarm'), U(0.6, 'swarm')], [D(), D('arrow')]],
  ['2v2 U runner60 vs E20', [U(0.6, 'runner'), U(0.6, 'runner')], [E(0.2), E(0.2)]],
  ['2v2 U swarm60 vs E20', [U(0.6, 'swarm'), U(0.6, 'swarm')], [E(0.2), E(0.2)]],
  ['2v2 U splitter60 vs E20', [U(0.6, 'splitter'), U(0.6, 'splitter')], [E(0.2), E(0.2)]],
  ['2v2 splitter40 vs D', [E(0.4, 'splitter'), E(0.4, 'splitter')], [D(), D('arrow')]],
  ['2v2 U splitter60 vs D', [U(0.6, 'splitter'), U(0.6, 'splitter')], [D(), D('arrow')]],
  ['2v2 smelterOnly vs D', [D('smelter'), D('smelter')], [D(), D('arrow')]],
  ['2v2 smelter-heavy vs D', [D('smelterHeavy'), D('smelterHeavy')], [D(), D('arrow')]],
  ['2v2 D+sm vs D', [D('mix5'), D('mix5')], [D(), D('arrow')]],
  ['2v2 splitter40 vs E40', [E(0.4, 'splitter'), E(0.4, 'splitter')], [E(0.4), E(0.4)]],
  ['2v2 U splitter60 vs U60', [U(0.6, 'splitter'), U(0.6, 'splitter')], [U(0.6), U(0.6)]],
  ['2v2 U mix60 vs D', [U(0.6), U(0.6)], [D(), D('arrow')]],
  ['2v2 burst8 brute50 vs D', [X(0.5, 'brute', 8), X(0.5, 'brute', 8)], [D(), D('arrow')]],
];
const sdStart = S.waveStartSec(S.WAVE.SUDDEN_DEATH_WAVE) / 60;
console.log(`waves every ${S.WAVE_EVERY}s, SD wave ${S.WAVE.SUDDEN_DEATH_WAVE} starts at ${sdStart.toFixed(1)} min; ${N} seeds x 2 seatings`);
let fast = 0, fastVsD = 0; const out = [];
for (const [l, a, b] of rows) {
  if (filter && !l.includes(filter)) continue;
  let w = 0, lo = 0, d = 0, inSd3 = 0, preSd = 0; const mins = [];
  for (let s = 1; s <= N; s++) for (const swap of [false, true]) {
    const r = swap ? B.run(l, b, a, { seed: s, maxMin: 30 }) : B.run(l, a, b, { seed: s, maxMin: 30 });
    const me = swap ? 'R' : 'L';
    if (r.winner === me) w++; else if (r.winner === 'draw' || r.winner === 'timeout') d++; else lo++;
    mins.push(r.min);
    if (r.min < sdStart) preSd++; else if (r.min <= sdStart + 3) inSd3++;
    if (r.winner === me && r.min < 8 && a.some((x) => x.send > 0)) { fast++; if (b.every((x) => !x.send)) fastVsD++; }
  }
  mins.sort((x, y) => x - y);
  const row = { l, w, lo, d, min: mins[0], med: mins[mins.length >> 1], max: mins[mins.length - 1], preSd, inSd3, n: 2 * N };
  out.push(row);
  console.log(`  ${l.padEnd(26)} first ${String(w).padStart(2)}/${2 * N} (lost ${lo}, draw ${d}) | min ${row.min}-${row.med}-${row.max} | before SD ${preSd}, SD<=3min ${inSd3}`);
}
console.log(`sender wins under 8 min: ${fast} (against a pure defender: ${fastVsD}; the rest are sender-vs-sender rows where the other side collapsed to neutral waves)`);
module.exports = out;
