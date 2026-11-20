// Correctheidstest voor de cube-solver. Run: node test/solver.test.js
// Lost willekeurige scrambles op met beide oplossers en verifieert elke
// oplossing met isSolved. Aantallen instelbaar: N_KOCIEMBA / N_LBL (env).
'use strict';

const assert = require('node:assert');
const S = require('../src/cube-solver/solver.js');
const K = require('../src/cube-solver/kociemba.js');

const N_KOCIEMBA = +(process.env.N_KOCIEMBA || 200);
const N_LBL = +(process.env.N_LBL || 25);
const N_STAGED = +(process.env.N_STAGED || 25);

// --- facelet-conversie: round-trip en validatie ---
{
  const s = S.applySeq(S.solvedState(), S.randomScramble(30));
  const back = S.faceletsToState(S.stateToFacelets(s));
  assert.ok(!back.error, 'round-trip zonder fout');
  assert.deepEqual(back.state, s, 'facelets round-trip');

  // twee randen verwisseld → pariteitsfout
  const F = S.stateToFacelets(S.solvedState());
  const [a, b] = [S.edgeFacelet[0], S.edgeFacelet[1]];
  [F[a[0]], F[b[0]]] = [F[b[0]], F[a[0]]];
  [F[a[1]], F[b[1]]] = [F[b[1]], F[a[1]]];
  assert.ok(S.faceletsToState(F).error, 'onmogelijke kubus geweigerd');
  console.log('OK facelet-conversie + validatie');
}

// --- elke zet is een echte vlakdraaiing ---
// isSolved hierboven en hieronder controleert alleen of de solver met zijn
// eigen MOVES rondkomt. Of die zetten ook op een echte kubus bestaan, ziet
// hij niet: een D die de hoeken met de klok mee en de randen tegen de klok in
// draaide, loste intern alles op, maar ging op een echte kubus mis. Daarom
// hier een meetkundig model van de 54 stickers, los van solver.js: elk
// stickertje heeft een plek in 3D (x rechts, y omhoog, z naar voren, maal 2
// zodat het stickertje een halve kubus buiten zijn blokje zit), en een zet
// draait de laag een kwartslag met de klok mee, gezien vanaf dat vlak.
{
  // vlakvolgorde en leesrichting van Kociemba (U R F D L B, rij voor rij)
  const SPOT = {
    U: (r, c) => [c - 1, 1, r - 1],   // van boven, B bovenaan
    R: (r, c) => [1, 1 - r, 1 - c],   // van rechts, F links
    F: (r, c) => [c - 1, 1 - r, 1],
    D: (r, c) => [c - 1, -1, 1 - r],  // van onder, F bovenaan
    L: (r, c) => [-1, 1 - r, c - 1],  // van links, B links
    B: (r, c) => [1 - c, 1 - r, -1],  // van achter, R links
  };
  const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const KEYS = 'URFDLB';
  const pos = [], at = new Map();
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) {
    const k = KEYS[f], n = NORMAL[k];
    const p = SPOT[k]((i / 3) | 0, i % 3).map((v, a) => 2 * v + n[a]);
    pos.push(p); at.set(p.join(), f * 9 + i);
  }
  assert.equal(at.size, 54, 'elk stickertje een eigen plek');
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // kwartslag met de klok mee, gezien van buitenaf langs as n:
  // -90° om n (rechtshandig), dus v -> (v·n)n - n×v
  function turn(F, k) {
    const n = NORMAL[k], G = F.slice();
    pos.forEach((p, i) => {
      if (dot(p, n) < 2) return;                         // niet in deze laag
      const q = cross(n, p).map((v, a) => dot(p, n) * n[a] - v);
      G[at.get(q.join())] = F[i];
    });
    return G;
  }
  for (let t = 0; t < 20; t++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const F = S.stateToFacelets(s);
    for (const k of KEYS) {
      let want = F;
      for (const suf of ['', '2', "'"]) {                // 1, 2 en 3 kwartslagen
        want = turn(want, k);
        assert.deepEqual(S.stateToFacelets(S.applySeq(S.clone(s), [k + suf])), want,
          'zet ' + k + suf + ' is een echte vlakdraaiing');
      }
    }
  }
  console.log('OK alle 18 zetten zijn echte vlakdraaiingen');

  // De animatie in app.js draait de laag van een zet met een CSS-rotatie en
  // kleurt daarna om naar de volgende stand. Dan moet elk stickertje na de
  // rotatie precies staan waar zijn kleur in die volgende stand hoort.
  const app = require('node:fs').readFileSync(__dirname + '/../src/cube-solver/app.js', 'utf8');
  const anim = app.match(/const MOVE_ANIM = \{[\s\S]*?\n  \};/);
  const spot = app.match(/function faceletCubie\([\s\S]*?\n  \}/);
  assert.ok(anim && spot, 'MOVE_ANIM en faceletCubie gevonden in app.js');
  const { MOVE_ANIM, faceletCubie } = new Function(anim[0] + spot[0] + 'return {MOVE_ANIM, faceletCubie};')();
  // CSS-assen: x rechts, y OMLAAG, z naar de kijker; rotaties volgens de spec
  const CSS_NORMAL = { U: [0, -1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, 1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const rot = (axis, deg, [x, y, z]) => {
    const c = Math.round(Math.cos(deg * Math.PI / 180)), s = Math.round(Math.sin(deg * Math.PI / 180));
    if (axis === 'X') return [x, y * c - z * s, y * s + z * c];
    if (axis === 'Y') return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  };
  const cssPos = [], cssAt = new Map();
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) {
    const k = KEYS[f], cub = faceletCubie(k, (i / 3) | 0, i % 3);
    const p = cub.map((v, a) => 2 * v + CSS_NORMAL[k][a]);
    cssPos.push({ cub, p }); cssAt.set(p.join(), f * 9 + i);
  }
  for (let t = 0; t < 5; t++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const F = S.stateToFacelets(s);
    for (const k of KEYS) for (const [suf, amt] of [['', 1], ['2', 2], ["'", -1]]) {
      const a = MOVE_ANIM[k], next = S.stateToFacelets(S.applySeq(S.clone(s), [k + suf]));
      const shown = F.slice();
      cssPos.forEach(({ cub, p }, i) => {
        if (a.sel(...cub)) shown[cssAt.get(rot(a.axis, a.deg * amt, p).join())] = F[i];
      });
      assert.deepEqual(shown, next, 'animatie van ' + k + suf + ' eindigt in de volgende stand');
    }
  }
  console.log('OK animatie draait elke zet de goede kant op');
}

// --- Kociemba: N scrambles, elke oplossing geverifieerd, ±20 zetten ---
{
  K.buildTables();
  let totalLen = 0, maxLen = 0;
  for (let i = 0; i < N_KOCIEMBA; i++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const sol = K.solve(S.clone(s), { maxTime: 1000 });
    assert.ok(sol, 'kociemba vond een oplossing (scramble ' + i + ')');
    assert.ok(S.isSolved(S.applySeq(S.clone(s), sol)), 'oplossing klopt (scramble ' + i + ')');
    totalLen += sol.length;
    if (sol.length > maxLen) maxLen = sol.length;
  }
  const avg = totalLen / N_KOCIEMBA;
  assert.ok(maxLen <= 30, 'max lengte redelijk (' + maxLen + ')');
  console.log('OK kociemba: ' + N_KOCIEMBA + ' scrambles, gem. ' +
    avg.toFixed(1) + ' zetten, max ' + maxLen);
}

// --- laag-voor-laag fallback: N scrambles, geverifieerd ---
{
  for (let i = 0; i < N_LBL; i++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const sol = S.solveCube(S.clone(s));
    assert.ok(sol, 'LBL vond een oplossing (scramble ' + i + ')');
    assert.ok(S.isSolved(S.applySeq(S.clone(s), sol)), 'LBL-oplossing klopt (scramble ' + i + ')');
  }
  // al opgeloste kubus → lege oplossing
  assert.deepEqual(S.solveCube(S.solvedState()), []);
  console.log('OK laag-voor-laag fallback: ' + N_LBL + ' scrambles');
}

// --- staged leer-modus: fases in de juiste volgorde, elk deeldoel bereikt ---
{
  const KEYS = ['cross', 'corners1', 'middle', 'eo', 'co', 'cp', 'ep'];
  // controleert het deeldoel van één fase op de tussentoestand `s`
  const subgoalOk = (key, s) => {
    if (key === 'cross') return [4, 5, 6, 7].every(e => s.ep[e] === e && s.eo[e] === 0);
    if (key === 'corners1') return [4, 5, 6, 7].every(e => s.ep[e] === e && s.eo[e] === 0) &&
      [4, 5, 6, 7].every(c => s.cp[c] === c && s.co[c] === 0);
    if (key === 'middle') { for (let i = 4; i < 12; i++) if (s.ep[i] !== i || s.eo[i] !== 0) return false; return true; }
    if (key === 'eo') return [0, 1, 2, 3].every(i => s.eo[i] === 0);
    if (key === 'co') return [0, 1, 2, 3].every(i => s.eo[i] === 0 && s.co[i] === 0);
    if (key === 'cp') return [0, 1, 2, 3].every(i => s.cp[i] === i && s.co[i] === 0 && s.eo[i] === 0);
    if (key === 'ep') return S.isSolved(s);
    return false;
  };
  let totalLen = 0, maxLen = 0;
  for (let i = 0; i < N_STAGED; i++) {
    const scr = S.applySeq(S.solvedState(), S.randomScramble(25));
    const staged = S.solveStaged(S.clone(scr));
    assert.ok(staged, 'staged vond een oplossing (scramble ' + i + ')');
    assert.deepEqual(staged.stages.map(st => st.key), KEYS, 'fases in juiste volgorde (scramble ' + i + ')');
    // loop de fases langs en verifieer elk deeldoel op de echte tussentoestand
    let s = S.clone(scr);
    for (const st of staged.stages) {
      s = S.applySeq(s, st.moves);
      assert.ok(subgoalOk(st.key, s), 'deeldoel "' + st.key + '" bereikt (scramble ' + i + ')');
    }
    assert.ok(S.isSolved(s), 'staged-oplossing klopt (scramble ' + i + ')');
    // de platte zettenlijst moet dezelfde kubus oplossen
    assert.ok(S.isSolved(S.applySeq(S.clone(scr), staged.moves)), 'platte zettenlijst klopt (scramble ' + i + ')');
    totalLen += staged.moves.length;
    if (staged.moves.length > maxLen) maxLen = staged.moves.length;
  }
  // al opgeloste kubus → 7 fases, geen zetten
  const solved = S.solveStaged(S.solvedState());
  assert.equal(solved.stages.length, 7, 'ook opgeloste kubus krijgt 7 fases');
  assert.equal(solved.moves.length, 0, 'opgeloste kubus: nul zetten');
  console.log('OK staged leer-modus: ' + N_STAGED + ' scrambles, gem. ' +
    (totalLen / N_STAGED).toFixed(0) + ' zetten, max ' + maxLen);
}

console.log('\nAlle solver-tests geslaagd ✔');
