// Correctheidstest voor de cube-solver. Run: node test/solver.test.js
// Lost willekeurige scrambles op met alle oplossers (3×3 en 2×2) en verifieert
// elke oplossing. Aantallen instelbaar: N_KOCIEMBA / N_LBL / N_STAGED /
// N_POCKET (env).
'use strict';

const assert = require('node:assert');
const S = require('../src/cube-solver/solver.js');
const K = require('../src/cube-solver/kociemba.js');
const P = require('../src/cube-solver/pocket.js');

const N_KOCIEMBA = +(process.env.N_KOCIEMBA || 200);
const N_LBL = +(process.env.N_LBL || 25);
const N_STAGED = +(process.env.N_STAGED || 25);
const N_POCKET = +(process.env.N_POCKET || 300);

// MOVE_ANIM en faceletCubie uit app.js: de animatie van de pagina, voor beide maten
const APP = (() => {
  const app = require('node:fs').readFileSync(__dirname + '/../src/cube-solver/app.js', 'utf8');
  const anim = app.match(/const MOVE_ANIM = \{[\s\S]*?\n  \};/);
  const spot = app.match(/function faceletCubie\([\s\S]*?\n  \}/);
  assert.ok(anim && spot, 'MOVE_ANIM en faceletCubie gevonden in app.js');
  return new Function(anim[0] + spot[0] + 'return {MOVE_ANIM, faceletCubie};')();
})();
// CSS-assen: x rechts, y OMLAAG, z naar de kijker; rotaties volgens de spec
const CSS_NORMAL = { U: [0, -1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, 1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const cssRot = (axis, deg, [x, y, z]) => {
  const c = Math.round(Math.cos(deg * Math.PI / 180)), s = Math.round(Math.sin(deg * Math.PI / 180));
  if (axis === 'X') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'Y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
};
// De animatie draait de laag van een zet met een CSS-rotatie en kleurt daarna
// om naar de volgende stand. Dan moet elk stickertje na de rotatie precies
// staan waar zijn kleur in die volgende stand hoort. Geeft een functie
// (kleuren, zet) -> kleuren zoals het scherm ze na de animatie laat zien.
function animator(n) {
  const cssPos = [], cssAt = new Map();
  for (let f = 0; f < 6; f++) for (let i = 0; i < n * n; i++) {
    const k = 'URFDLB'[f], cub = APP.faceletCubie(k, (i / n) | 0, i % n, n);
    const p = cub.map((v, a) => 2 * v + CSS_NORMAL[k][a]);
    cssPos.push({ cub, p }); cssAt.set(p.join(), f * n * n + i);
  }
  assert.equal(cssAt.size, 6 * n * n, 'elk stickertje een eigen plek op het scherm (' + n + '×' + n + ')');
  return (F, mv) => {
    const a = APP.MOVE_ANIM[mv[0]], amt = mv[1] === "'" ? -1 : mv[1] === '2' ? 2 : 1;
    const shown = F.slice();
    cssPos.forEach(({ cub, p }, i) => {
      if (a.sel(...cub)) shown[cssAt.get(cssRot(a.axis, a.deg * amt, p).join())] = F[i];
    });
    return shown;
  };
}

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

  // de animatie op de pagina laat precies die zetten zien
  const shown = animator(3);
  for (let t = 0; t < 5; t++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const F = S.stateToFacelets(s);
    for (const k of KEYS) for (const suf of ['', '2', "'"]) {
      assert.deepEqual(shown(F, k + suf), S.stateToFacelets(S.applySeq(S.clone(s), [k + suf])),
        'animatie van ' + k + suf + ' eindigt in de volgende stand');
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

// ============================================================================
//  2×2 (pocket.js)
// ============================================================================

// --- meetkundig model van de 24 stickers, los van pocket.js ---
// Zelfde opzet als hierboven, maar elk blokje staat nu op ±1 (= 2 × ±½) en een
// stickertje zit één stap buiten zijn blokje.
const P2 = (() => {
  const SPOT = {
    U: (r, c) => [2 * c - 1, 1, 2 * r - 1],
    R: (r, c) => [1, 1 - 2 * r, 1 - 2 * c],
    F: (r, c) => [2 * c - 1, 1 - 2 * r, 1],
    D: (r, c) => [2 * c - 1, -1, 1 - 2 * r],
    L: (r, c) => [-1, 1 - 2 * r, 2 * c - 1],
    B: (r, c) => [1 - 2 * c, 1 - 2 * r, -1],
  };
  const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const pos = [], at = new Map();
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = 'URFDLB'[f], n = NORMAL[k];
    const p = SPOT[k]((i / 2) | 0, i % 2).map((v, a) => v + n[a]);
    pos.push(p); at.set(p.join(), f * 4 + i);
  }
  assert.equal(at.size, 24, '2×2: elk stickertje een eigen plek');
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // -90° om n: met minLayer 1 alleen de laag (een zet), met -9 de hele kubus
  function rotate(F, n, minLayer) {
    const G = F.slice();
    pos.forEach((p, i) => {
      if (dot(p, n) < minLayer) return;
      const q = cross(n, p).map((v, a) => dot(p, n) * n[a] - v);
      G[at.get(q.join())] = F[i];
    });
    return G;
  }
  const turn = (F, mv) => {
    const times = mv[1] === "'" ? 3 : mv[1] === '2' ? 2 : 1;
    for (let t = 0; t < times; t++) F = rotate(F, NORMAL[mv[0]], 1);
    return F;
  };
  const wholeCube = (F, axis) => rotate(F, NORMAL[axis], -9);
  const looksSolved = F => [0, 1, 2, 3, 4, 5].every(f => new Set(F.slice(4 * f, 4 * f + 4)).size === 1);
  return { turn, wholeCube, looksSolved };
})();

// --- zetten, animatie en facelets ---
{
  assert.deepEqual(P.stateToFacelets(P.solvedState()), [...Array(24)].map((_, i) => (i / 4) | 0),
    '2×2: opgeloste kubus heeft effen vlakken');
  const shown = animator(2);
  for (let t = 0; t < 20; t++) {
    const s = P.randomState();
    const F = P.stateToFacelets(s);
    for (const mv of P.MOVE_NAMES) {
      const next = P.stateToFacelets(P.applySeq(P.clone(s), [mv]));
      assert.deepEqual(next, P2.turn(F, mv), '2×2: zet ' + mv + ' is een echte vlakdraaiing');
      assert.deepEqual(shown(F, mv), next, '2×2: animatie van ' + mv + ' eindigt in de volgende stand');
    }
  }
  assert.deepEqual(P.MOVE_NAMES.map(m => m[0]).filter((f, i, a) => a.indexOf(f) === i), ['U', 'R', 'F'],
    '2×2: alleen U, R en F — de hoek linksachter onder blijft staan');
  console.log('OK 2×2: zetten zijn echte draaiingen, animatie klopt');
}

// --- de afstandstabel: alle 3 674 160 standen, met de bekende verdeling ---
{
  const t0 = Date.now();
  P.buildTables();
  const ms = Date.now() - t0;
  // aantal standen per afstand (halve draai = 1 zet), zie bv. Wikipedia "Pocket Cube"
  assert.deepEqual(P.histogram(),
    [1, 9, 54, 321, 1847, 9992, 50136, 227536, 870072, 1887748, 623800, 2644],
    '2×2: verdeling van de afstanden');
  console.log('OK 2×2: afstandstabel compleet (' + ms + ' ms), hooguit 11 zetten');
}

// --- kortste oplossing, ook als je de kubus anders vasthoudt of andere kleuren hebt ---
{
  let total = 0, max = 0;
  for (let i = 0; i < N_POCKET; i++) {
    const s = P.randomState();
    assert.ok(P.isValid(s) && !P.isSolved(s), '2×2: willekeurige stand is geldig en niet opgelost');
    const sol = P.solve(P.clone(s));
    assert.ok(sol && P.isSolved(P.applySeq(P.clone(s), sol)), '2×2: oplossing klopt (' + i + ')');
    assert.equal(sol.length, P.distance(s), '2×2: oplossing is de kortste (' + i + ')');
    total += sol.length; max = Math.max(max, sol.length);

    // Zelfde kubus, maar met een willekeurig kleurenschema en willekeurig
    // gedraaid in je hand. De pagina moet precies de ingevoerde kleuren terug
    // laten zien (frame 0), en de oplossing moet — gedraaid op de stickers,
    // los van pocket.js — echt elk vlak effen maken.
    const relabel = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - .5);
    let C = P.stateToFacelets(s).map(c => relabel[c]);
    for (let k = (Math.random() * 6) | 0; k > 0; k--) C = P2.wholeCube(C, Math.random() < .5 ? 'U' : 'R');
    const r = P.faceletsToState(C);
    assert.ok(!r.error, '2×2: invoer geaccepteerd (' + r.error + ')');
    assert.deepEqual(P.stateToFacelets(r.state, r.faceColor), C, '2×2: frame 0 = de ingevoerde kleuren');
    let G = C;
    for (const mv of P.solve(r.state)) G = P2.turn(G, mv);
    assert.ok(P2.looksSolved(G), '2×2: na de oplossing is elk vlak effen (' + i + ')');
  }
  assert.deepEqual(P.solve(P.solvedState()), [], '2×2: opgeloste kubus → geen zetten');
  console.log('OK 2×2: ' + N_POCKET + ' standen kortst opgelost (gem. ' + (total / N_POCKET).toFixed(1) +
    ', max ' + max + '), ook gedraaid en met andere kleuren');
}

// --- onmogelijke invoer wordt geweigerd ---
{
  const base = P.stateToFacelets(P.randomState());
  const err = (C, what) => {
    const r = P.faceletsToState(C);
    assert.ok(typeof r.error === 'string' && !r.state, '2×2: ' + what + ' geweigerd');
    return r.error;
  };
  const [a, b, c] = P.cornerFacelet[0];
  const twisted = base.slice(); [twisted[a], twisted[b], twisted[c]] = [base[c], base[a], base[b]];
  assert.match(err(twisted, 'gedraaide hoek'), /verkeerd gedraaid/);
  const mirrored = base.slice(); [mirrored[b], mirrored[c]] = [base[c], base[b]];
  err(mirrored, 'gespiegelde hoek');
  const recoloured = base.slice(); recoloured[0] = (base[0] + 1) % 6;
  assert.match(err(recoloured, 'kleur 5× gebruikt'), /precies 4 keer/);
  const empty = base.slice(); empty[7] = null;
  assert.match(err(empty, 'leeg vlakje'), /Niet alle vlakjes/);
  // twee stickers van verschillende hoeken geruild: telling klopt nog, kubus niet
  const swapped = base.slice(); [swapped[3], swapped[0]] = [base[0], base[3]];
  if (base[0] !== base[3]) err(swapped, 'twee stickers geruild');
  console.log('OK 2×2: onmogelijke kubussen geweigerd');
}

// --- leer-route: drie fases, elk deeldoel bereikt ---
{
  // de uitleg op de pagina belooft: T-perm ruilt de twee rechter hoeken, Y-perm
  // twee schuin tegenover elkaar, en geen van beide draait een hoek of raakt de onderlaag
  const T = P.applySeq(P.solvedState(), P.ALG_TPERM), Y = P.applySeq(P.solvedState(), P.ALG_YPERM);
  assert.deepEqual(T, { cp: [3, 1, 2, 0, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] }, 'T-perm ruilt rechtsvoor/rechtsachter');
  assert.deepEqual(Y, { cp: [2, 1, 0, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] }, 'Y-perm ruilt schuin');
  for (const alg of [P.ALG_SUNE, P.ALG_ANTISUNE]) {
    const s = P.applySeq(P.solvedState(), alg);
    assert.ok([4, 5, 6, 7].every(c => s.cp[c] === c && s.co[c] === 0), 'Sune laat de onderlaag staan');
  }
  const ok = {
    layer: s => [4, 5, 6, 7].every(c => s.cp[c] === c && s.co[c] === 0),
    co: s => [4, 5, 6, 7].every(c => s.cp[c] === c && s.co[c] === 0) && [0, 1, 2, 3].every(c => s.co[c] === 0),
    cp: s => P.isSolved(s),
  };
  let total = 0, max = 0;
  const n = Math.min(N_POCKET, 200);
  for (let i = 0; i < n; i++) {
    const start = P.randomState();
    const staged = P.solveStaged(P.clone(start));
    assert.ok(staged, '2×2 leer-route gevonden (' + i + ')');
    assert.deepEqual(staged.stages.map(st => st.key), ['layer', 'co', 'cp'], '2×2: fases in volgorde');
    let s = P.clone(start);
    for (const st of staged.stages) {
      s = P.applySeq(s, st.moves);
      assert.ok(ok[st.key](s), '2×2: deeldoel "' + st.key + '" bereikt (' + i + ')');
    }
    assert.ok(P.isSolved(P.applySeq(P.clone(start), staged.moves)), '2×2: platte zettenlijst klopt');
    total += staged.moves.length; max = Math.max(max, staged.moves.length);
  }
  const solved = P.solveStaged(P.solvedState());
  assert.equal(solved.stages.length, 3, '2×2: ook opgelost drie fases');
  assert.equal(solved.moves.length, 0, '2×2: opgelost → nul zetten');
  console.log('OK 2×2 leer-route: ' + n + ' standen, gem. ' + (total / n).toFixed(0) + ' zetten, max ' + max);
}

console.log('\nAlle solver-tests geslaagd ✔');
