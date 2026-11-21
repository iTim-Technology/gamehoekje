// ============================================================================
//  2×2-kubus (Pocket Cube): model, optimale oplosser en leer-route
//  Wordt in Node getest én (als tekst) in de pagina en de Worker ingebed.
//
//  Een 2×2 bestaat alleen uit hoeken. Nummering en oriëntatie zijn dezelfde
//  als in solver.js:  URF UFL ULB UBR DFR DLF DBL DRB = 0..7.
//
//  De hoek DBL (linksachter onder, 6) beweegt nooit: we draaien alleen U, R
//  en F. Een 2×2 heeft geen middens, dus die ene hoek legt vast hoe de kubus
//  in je hand ligt én welke kleur bij welk vlak hoort. Bovendien zijn U, R en
//  F precies de drie vlakken die je op het scherm ziet.
//
//  Facelets: U=0..3 R=4..7 F=8..11 D=12..15 L=16..19 B=20..23, per vlak
//  0 1 / 2 3, in dezelfde leesrichting als de 3×3 (Kociemba).
//
//  Alles staat in één IIFE: in de Worker worden solver.js, kociemba.js en dit
//  bestand achter elkaar in één script gezet, en solver.js heeft al een
//  top-level MOVES, clone, applySeq …
// ============================================================================
const Pocket = (function(){
  // De hoekdelen van de 3×3-zetten in solver.js (en dus net zo getest).
  const MOVES = {
    U:{ cp:[3,0,1,2,4,5,6,7], co:[0,0,0,0,0,0,0,0] },
    R:{ cp:[4,1,2,0,7,5,6,3], co:[2,0,0,1,1,0,0,2] },
    F:{ cp:[1,5,2,3,0,4,6,7], co:[1,2,0,0,2,1,0,0] },
  };
  const FIXED = 6;                                        // DBL
  const MOVE_NAMES = ["U","U2","U'","R","R2","R'","F","F2","F'"];

  function solvedState(){ return { cp:[0,1,2,3,4,5,6,7], co:[0,0,0,0,0,0,0,0] }; }
  function clone(s){ return { cp:s.cp.slice(), co:s.co.slice() }; }
  function applyMove(s, m){
    const cp = new Array(8), co = new Array(8);
    for(let i=0;i<8;i++){ cp[i] = s.cp[m.cp[i]]; co[i] = (s.co[m.cp[i]] + m.co[i]) % 3; }
    return { cp, co };
  }
  function turnAmt(t){ return t[1]==="'" ? 3 : t[1]==="2" ? 2 : 1; }
  function applySeq(s, tokens){
    for(const t of tokens){
      const m = MOVES[t[0]];
      if(!m) throw new Error("Onbekende zet voor de 2×2: " + t);
      for(let k=turnAmt(t); k>0; k--) s = applyMove(s, m);
    }
    return s;
  }
  function isSolved(s){
    for(let i=0;i<8;i++) if(s.cp[i]!==i || s.co[i]!==0) return false;
    return true;
  }
  // geldig = DBL op zijn plek en goed gedraaid, elke hoek één keer, som co ≡ 0
  function isValid(s){
    if(!s || !Array.isArray(s.cp) || !Array.isArray(s.co) || s.cp.length!==8 || s.co.length!==8) return false;
    if(s.cp[FIXED]!==FIXED || s.co[FIXED]!==0) return false;
    if(new Set(s.cp).size!==8 || s.cp.some(c=>!(c>=0 && c<8))) return false;
    if(s.co.some(o=>!(o>=0 && o<3))) return false;
    return s.co.reduce((a,b)=>a+b, 0) % 3 === 0;
  }

  // ---- coördinaten ---------------------------------------------------------
  // De zeven hoeken die bewegen: 7! = 5040 permutaties. Oriëntatie: de hoeken
  // op plek 0..5 vrij, die op plek 7 volgt uit de som: 3^6 = 729. Samen de hele
  // 2×2: 5040 × 729 = 3 674 160 standen.
  const N_PERM = 5040, N_ORI = 729, N_STATES = N_PERM * N_ORI;
  const POS  = [0,1,2,3,4,5,7];                           // plekken die bewegen
  const SLOT = [0,1,2,3,4,5,-1,6];                        // plek/stuk -> index in POS

  function permIndex(cp){                                 // Lehmer-code, 0..5039
    let idx = 0;
    for(let i=0;i<7;i++){
      const a = SLOT[cp[POS[i]]];
      let smaller = 0;
      for(let j=i+1;j<7;j++) if(SLOT[cp[POS[j]]] < a) smaller++;
      idx = idx * (7 - i) + smaller;
    }
    return idx;
  }
  function permFrom(idx, cp){
    const digit = new Array(7);
    for(let i=6;i>=0;i--){ digit[i] = idx % (7 - i); idx = (idx / (7 - i)) | 0; }
    const avail = [0,1,2,3,4,5,6];
    for(let i=0;i<7;i++) cp[POS[i]] = POS[avail.splice(digit[i], 1)[0]];
    cp[FIXED] = FIXED;
    return cp;
  }
  function oriIndex(co){ let x = 0; for(let i=5;i>=0;i--) x = x * 3 + co[i]; return x; }
  function oriFrom(x, co){
    let sum = 0;
    for(let i=0;i<6;i++){ co[i] = x % 3; sum += co[i]; x = (x / 3) | 0; }
    co[FIXED] = 0;
    co[7] = (3 - sum % 3) % 3;
    return co;
  }

  // ---- tabellen: zet-tabellen + afstand van élke stand tot opgelost ----------
  // Breedte-eerst vanaf de opgeloste kubus over alle 3,67 miljoen standen; één
  // byte per stand. Daarna is oplossen een kwestie van steeds de zet nemen die
  // de afstand met één verlaagt: altijd de kortste oplossing (hooguit 11 zetten).
  let permMove = null, oriMove = null, DIST = null;
  function buildTables(){
    if(DIST) return;
    permMove = new Uint16Array(N_PERM * 9);
    oriMove  = new Uint16Array(N_ORI * 9);
    const faces = [MOVES.U, MOVES.R, MOVES.F];
    for(let p=0;p<N_PERM;p++){
      const s = { cp:permFrom(p, new Array(8)), co:[0,0,0,0,0,0,0,0] };
      for(let f=0;f<3;f++){
        let t = s;
        for(let k=0;k<3;k++){ t = applyMove(t, faces[f]); permMove[p*9 + f*3 + k] = permIndex(t.cp); }
      }
    }
    for(let o=0;o<N_ORI;o++){
      const s = { cp:[0,1,2,3,4,5,6,7], co:oriFrom(o, new Array(8)) };
      for(let f=0;f<3;f++){
        let t = s;
        for(let k=0;k<3;k++){ t = applyMove(t, faces[f]); oriMove[o*9 + f*3 + k] = oriIndex(t.co); }
      }
    }
    const dist = new Uint8Array(N_STATES).fill(255);
    dist[0] = 0;                                          // opgelost = perm 0, ori 0
    let count = 1;
    for(let d=0; d<20 && count<N_STATES; d++){
      for(let i=0;i<N_STATES;i++){
        if(dist[i]!==d) continue;
        const p = (i / N_ORI) | 0, o = i - p * N_ORI;
        for(let m=0;m<9;m++){
          const j = permMove[p*9 + m] * N_ORI + oriMove[o*9 + m];
          if(dist[j]===255){ dist[j] = d + 1; count++; }
        }
      }
    }
    DIST = dist;
  }

  // kortste oplossing (in zetten, een halve draai telt als één) of null
  function solve(state){
    if(!isValid(state)) return null;
    buildTables();
    let p = permIndex(state.cp), o = oriIndex(state.co);
    let d = DIST[p * N_ORI + o];
    if(d===255) return null;
    const out = [];
    while(d > 0){
      let m = 0;
      for(; m<9; m++){
        const np = permMove[p*9 + m], no = oriMove[o*9 + m];
        if(DIST[np * N_ORI + no] === d - 1){ p = np; o = no; d--; break; }
      }
      if(m===9) return null;                              // kan niet, maar nooit vastlopen
      out.push(MOVE_NAMES[m]);
    }
    return out;
  }
  function distance(state){
    if(!isValid(state)) return -1;
    buildTables();
    return DIST[permIndex(state.cp) * N_ORI + oriIndex(state.co)];
  }
  // aantal standen per afstand (voor de test: moet de bekende verdeling zijn)
  function histogram(){
    buildTables();
    const h = [];
    for(let i=0;i<N_STATES;i++){ const d = DIST[i]; h[d] = (h[d] || 0) + 1; }
    return h;
  }

  // willekeurige stand, alle standen even waarschijnlijk (net als bij wedstrijden)
  function randomState(){
    const s = solvedState();
    do {
      permFrom(Math.floor(Math.random() * N_PERM), s.cp);
      oriFrom(Math.floor(Math.random() * N_ORI), s.co);
    } while(isSolved(s));
    return s;
  }

  // ---- facelets <-> hoeken -------------------------------------------------
  // De stickers van elke hoek, beginnend bij die op U/D en dan met de klok mee
  // (dezelfde volgorde als cornerFacelet in solver.js).
  const cornerFacelet = [
    [3,4,9], [2,8,17], [0,16,21], [1,20,5],
    [13,11,6], [12,19,10], [14,23,18], [15,7,22],
  ];
  const cornerColor = cornerFacelet.map(t => t.map(x => (x / 4) | 0));
  const CORNER_NAMES = [
    "rechtsvoor boven", "linksvoor boven", "linksachter boven", "rechtsachter boven",
    "rechtsvoor onder", "linksvoor onder", "linksachter onder", "rechtsachter onder",
  ];

  // faceColor[vlak] = de kleur van dat vlak; zonder: kleur = vlaknummer
  function stateToFacelets(s, faceColor){
    const F = new Array(24);
    for(let p=0;p<8;p++){
      const j = s.cp[p], ori = s.co[p];
      for(let k=0;k<3;k++) F[cornerFacelet[p][(k + ori) % 3]] = cornerColor[j][k];
    }
    return faceColor ? F.map(f => faceColor[f]) : F;
  }

  // 24 kleuren (0..5) -> {state, faceColor} of {error}. Welke kleur bij welk
  // vlak hoort volgt uit de hoek linksachter onder; welke kleuren tegenover
  // elkaar liggen uit de hoeken zelf (twee kleuren die nooit samen op een hoek
  // zitten). Zo werkt elk kleurenschema, hoe je de kubus ook vasthoudt.
  // `names` (optioneel) zijn de kleurnamen voor de foutmeldingen.
  function faceletsToState(C, names){
    const nm = i => names ? names[i] : "kleur " + i;
    if(!Array.isArray(C) || C.length!==24) return { error:"Een 2×2 heeft 24 vlakjes." };
    for(const v of C) if(!(v>=0 && v<=5) || v!==(v|0)) return { error:"Niet alle vlakjes zijn ingekleurd." };
    const cnt = [0,0,0,0,0,0];
    for(const v of C) cnt[v]++;
    for(let i=0;i<6;i++){
      if(cnt[i]!==4) return { error:"Elke kleur moet precies 4 keer voorkomen (" + nm(i) + ": " + cnt[i] + "×)." };
    }
    const tri = cornerFacelet.map(t => t.map(x => C[x]));
    for(let p=0;p<8;p++){
      if(new Set(tri[p]).size!==3) return { error:"De hoek " + CORNER_NAMES[p] + " heeft twee keer dezelfde kleur." };
    }
    const meets = [0,1,2,3,4,5].map(() => [false,false,false,false,false,false]);
    for(const t of tri) for(const a of t) for(const b of t) meets[a][b] = true;
    const opp = [];
    for(let c=0;c<6;c++){
      const cand = [];
      for(let x=0;x<6;x++) if(!meets[c][x]) cand.push(x);
      if(cand.length!==1) return { error:"Deze kleuren passen niet op een echte kubus: kijk de hoeken na." };
      opp[c] = cand[0];
    }
    const [cD, cB, cL] = tri[FIXED];
    const faceColor = [opp[cD], opp[cL], opp[cB], cD, cL, cB];  // U R F D L B
    const faceOf = [];
    faceColor.forEach((c, f) => { faceOf[c] = f; });
    if(faceOf.filter(f => f!==undefined).length!==6) {
      return { error:"Deze kleuren passen niet op een echte kubus: kijk de hoeken na." };
    }
    const F = C.map(c => faceOf[c]);
    const cp = new Array(8), co = new Array(8);
    for(let p=0;p<8;p++){
      let ori = 0;
      while(ori<3 && F[cornerFacelet[p][ori]]!==0 && F[cornerFacelet[p][ori]]!==3) ori++;
      const c1 = F[cornerFacelet[p][(ori + 1) % 3]], c2 = F[cornerFacelet[p][(ori + 2) % 3]];
      const j = cornerColor.findIndex(t => t[1]===c1 && t[2]===c2);
      if(ori===3 || j<0) {
        return { error:"De hoek " + CORNER_NAMES[p] + " bestaat niet op een echte kubus: kijk zijn kleuren na." };
      }
      cp[p] = j; co[p] = ori;
    }
    if(new Set(cp).size!==8) return { error:"Er zit een hoek dubbel in de kubus." };
    if(co.reduce((a,b)=>a+b, 0) % 3!==0) return { error:"Onmogelijke kubus: een hoek is verkeerd gedraaid." };
    const state = { cp, co };
    if(!isValid(state)) return { error:"Deze kleuren passen niet op een echte kubus." };
    return { state, faceColor };
  }

  // ---- leer-route: de beginnersmethode in drie fases -------------------------
  //   1 onderlaag (op gevoel) · 2 bovenvlak (Sune / anti-Sune) ·
  //   3 hoeken bovenlaag (T-perm / Y-perm, plus een laatste U-draai)
  // Alle algoritmes gebruiken alleen U, R en F en laten de onderlaag staan.
  const ALG_SUNE     = ["R","U","R'","U","R","U2","R'"];
  const ALG_ANTISUNE = ["R","U2","R'","U'","R","U'","R'"];
  const ALG_TPERM    = ["R","U","R'","U'","R'","F","R2","U'","R'","U'","R","U","R'","F'"];
  const ALG_YPERM    = ["F","R","U'","R'","U'","R","U","R'","F'","R","U","R'","U'","R'","F","R","F'"];
  const U_SETUPS     = [["U"],["U'"],["U2"]];

  function keyOf(s){ return s.cp.join("") + s.co.join(""); }

  // kortste zettenreeks die de hoeken `pieces` op hun plek zet (en goed draait).
  // We volgen alleen die hoeken: hooguit 21·18·15 = 5670 standen.
  function piecesBFS(state, pieces){
    const ok = s => pieces.every(c => s.cp[c]===c && s.co[c]===0);
    if(ok(state)) return [];
    const key = s => pieces.map(c => { const q = s.cp.indexOf(c); return q * 3 + s.co[q]; }).join(",");
    const seen = new Set([key(state)]);
    let frontier = [{ s:state, path:[], last:"" }];
    while(frontier.length){
      const next = [];
      for(const node of frontier){
        for(const mv of MOVE_NAMES){
          if(mv[0]===node.last) continue;
          const ns = applySeq(node.s, [mv]);
          const k = key(ns);
          if(seen.has(k)) continue;
          seen.add(k);
          const path = node.path.concat([mv]);
          if(ok(ns)) return path;
          next.push({ s:ns, path, last:mv[0] });
        }
      }
      frontier = next;
    }
    return null;
  }

  // breedte-eerst over hele algoritmes (de kleinste aantal stappen wint)
  function opsBFS(state, ops, goal, maxOps){
    if(goal(state)) return [];
    const seen = new Set([keyOf(state)]);
    let frontier = [{ s:state, path:[] }];
    for(let depth=0; depth<maxOps && frontier.length; depth++){
      const next = [];
      for(const node of frontier){
        for(const op of ops){
          const ns = applySeq(node.s, op);
          const k = keyOf(ns);
          if(seen.has(k)) continue;
          seen.add(k);
          const path = node.path.concat(op);
          if(goal(ns)) return path;
          next.push({ s:ns, path });
        }
      }
      frontier = next;
    }
    return null;
  }

  // opeenvolgende draaien van hetzelfde vlak samenvoegen
  function compress(tokens){
    const out = [];
    for(const t of tokens){
      const last = out[out.length - 1];
      if(last && last[0]===t[0]){
        out.pop();
        const amt = (turnAmt(last) + turnAmt(t)) % 4;
        if(amt) out.push(t[0] + (amt===1 ? "" : amt===2 ? "2" : "'"));
      } else out.push(t);
    }
    return out;
  }

  const topOriented = s => s.co[0]===0 && s.co[1]===0 && s.co[2]===0 && s.co[3]===0;

  function solveStaged(state){
    if(!isValid(state)) return null;
    const out = { stages:[], moves:[] };
    let s = clone(state);
    const record = (key, seq) => {
      seq = compress(seq);
      out.stages.push({ key, moves:seq.slice() });
      out.moves = out.moves.concat(seq);
    };

    // Fase 1 — onderlaag. DBL staat al; telkens de goedkoopste volgende hoek.
    let seq = [];
    const placed = [], todo = [4, 5, 7];
    while(todo.length){
      let best = null, bestI = -1;
      todo.forEach((c, i) => {
        const sub = piecesBFS(s, placed.concat([c]));
        if(sub && (!best || sub.length < best.length)){ best = sub; bestI = i; }
      });
      if(!best) return null;
      s = applySeq(s, best); seq = seq.concat(best);
      placed.push(todo.splice(bestI, 1)[0]);
    }
    record("layer", seq);

    // Fase 2 — bovenvlak: de bovenste hoeken draaien.
    let sub = opsBFS(s, U_SETUPS.concat([ALG_SUNE, ALG_ANTISUNE]), topOriented, 8);
    if(!sub) return null;
    s = applySeq(s, sub); record("co", sub);

    // Fase 3 — hoeken bovenlaag op hun plek, en de laatste U-draai.
    sub = opsBFS(s, U_SETUPS.concat([ALG_TPERM, ALG_YPERM]), isSolved, 6);
    if(!sub) return null;
    s = applySeq(s, sub); record("cp", sub);

    if(!isSolved(applySeq(clone(state), out.moves))) return null;
    return out;
  }

  return { MOVES, MOVE_NAMES, solvedState, clone, applySeq, isSolved, isValid,
    buildTables, solve, distance, histogram, randomState, solveStaged, compress,
    stateToFacelets, faceletsToState, cornerFacelet, CORNER_NAMES,
    ALG_SUNE, ALG_ANTISUNE, ALG_TPERM, ALG_YPERM };
})();
if(typeof module!=="undefined" && module.exports) module.exports = Pocket;
if(typeof window!=="undefined") window.Pocket = Pocket;
