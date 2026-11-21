// ============================================================================
//  Rubik's Cube Solver – UI logic (mobile first, animated 3D view)
//  Relies on globals `CubeSolver` (solver.js, 3×3) and `Pocket` (pocket.js, 2×2).
//
//  The cube is drawn as N×N×N small cubies at fixed positions (26 for the 3×3,
//  8 for the 2×2). A move is shown by rotating the cubies of that layer in the
//  correct direction, then "baking" the result (cubies snap back, stickers
//  recolour to the new state). This way the on-screen turn always matches the
//  move you have to make. Everything size-specific lives in SIZES below.
// ============================================================================
(function(){
  const CS = window.CubeSolver;
  const PK = window.Pocket;

  // Kleur per vlak-index: 0=U 1=R 2=F 3=D 4=L 5=B. We tonen de kubus met WIT
  // onder en GEEL boven, zodat de leer-modus (net als in elke beginnershand-
  // leiding) de witte laag eerst opbouwt en met geel eindigt. Dat is een halve
  // draai (180°) om de voor-achter-as t.o.v. de standaard: wit<->geel én
  // rood<->oranje wisselen mee, groen blijft vóór. Twee paren omwisselen is een
  // ECHTE draaiing; alleen wit<->geel zou een spiegelbeeld geven dat niet op een
  // echte kubus bestaat. De solver/algoritmes werken op vlak-indexen — die
  // veranderen hier niets van.
  const COLORS = ["#ffd500","#ff7a1a","#1faa47","#f7f7f7","#c41e3a","#0051ba"]; // U=geel R=oranje F=groen D=wit L=rood B=blauw
  const COLOR_NAMES = ["Geel","Oranje","Groen","Wit","Rood","Blauw"];
  const FACE_KEYS = ["U","R","F","D","L","B"];
  const FACE_NAMES = {U:"Boven",R:"Rechts",F:"Voor",D:"Onder",L:"Links",B:"Achter"};

  // Human-readable move descriptions — consistent "klok"-logica for every face.
  // "met de klok mee" / "tegen de klok in" gezien als je recht naar dat vlak
  // kijkt. De animatie laat de echte draairichting zien, dus volg gewoon mee.
  const MOVE_TEXT = {
    "U":"Bovenkant met de klok mee","U'":"Bovenkant tegen de klok in","U2":"Bovenkant halve draai",
    "D":"Onderkant met de klok mee","D'":"Onderkant tegen de klok in","D2":"Onderkant halve draai",
    "R":"Rechterkant met de klok mee","R'":"Rechterkant tegen de klok in","R2":"Rechterkant halve draai",
    "L":"Linkerkant met de klok mee","L'":"Linkerkant tegen de klok in","L2":"Linkerkant halve draai",
    "F":"Voorkant met de klok mee","F'":"Voorkant tegen de klok in","F2":"Voorkant halve draai",
    "B":"Achterkant met de klok mee","B'":"Achterkant tegen de klok in","B2":"Achterkant halve draai",
  };


  // Per-move animation: which layer rotates and around which CSS axis/angle.
  // Coordinates are CSS (x right, y DOWN, z toward viewer), centred on the
  // cube: -1/0/1 for the 3×3, -0.5/0.5 for the 2×2, so the outer layer of a
  // face is simply "that side of 0". The animation must reproduce the solver's
  // MOVES permutation exactly; test/solver.test.js checks that for all 18 moves
  // of the 3×3 and the 9 of the 2×2. U and D turn opposite ways around the same
  // axis (each is clockwise seen from its own side), as do R/L and F/B.
  //   sel(x,y,z) -> true if a cubie is in the turning layer
  //   axis: "X"|"Y"|"Z" ; deg: base clockwise angle for the plain move
  const MOVE_ANIM = {
    U:{sel:(x,y,z)=>y<0, axis:"Y", deg:-90},
    D:{sel:(x,y,z)=>y>0, axis:"Y", deg: 90},
    R:{sel:(x,y,z)=>x>0, axis:"X", deg: 90},
    L:{sel:(x,y,z)=>x<0, axis:"X", deg:-90},
    F:{sel:(x,y,z)=>z>0, axis:"Z", deg: 90},
    B:{sel:(x,y,z)=>z<0, axis:"Z", deg:-90},
  };
  const TURN_MS = 450;

  // state -------------------------------------------------------------------
  let N = 3;                  // kubusmaat: 3 (3×3) of 2 (2×2)
  const inputBySize = {};     // ingevoerde kleuren per maat (blijven bij wisselen)
  let inputColors = null;     // 6·N·N colour indices of the current size
  let painter = null;         // stand -> kleuren, voor de kubus die nu wordt opgelost
  let faceColor = [0,1,2,3,4,5]; // kleur per vlak (U R F D L B) van die kubus
  let selectedColor = 0;
  let mode = "edit";          // "edit" | "solve"
  let frames = [];            // array of 54-colour arrays, one per step
  let solution = [];          // move tokens
  let stepIndex = 0;          // current playback frame
  let playing = false, playTimer = null;
  let animating = false;      // a layer turn is in progress
  let viewRX = 0, viewRY = 0; // current whole-cube rotation (degrees)

  // cubie bookkeeping
  const cubies = {};          // "x,y,z" -> cubie element
  let padRef = [];            // facelet index -> coloured pad element

  // learn mode --------------------------------------------------------------
  let solveMode = "fast";     // "fast" (kort) | "learn" (staged beginner)
  let stages = [];            // [{key,title,desc,algs,start,end,count}]
  let stageOf = [];           // flat move index -> stage index

  // Uitleg + algoritmes per fase van de beginnersmethode. De algoritme-notatie
  // is de "schone" vorm die je leert; de zetjes in de lijst kunnen er een extra
  // U-draai (AUF) omheen hebben om de kubus goed te zetten.
  const STAGE_INFO = {
    cross:    {title:"Wit kruis",       desc:"Leg de vier witte randen onderaan goed, zodat er een wit kruis ontstaat dat aan de zijkanten bij de middens past. Dit doe je op gevoel.", algs:[]},
    corners1: {title:"Witte hoeken",    desc:"Zet de vier witte hoeken op hun plek. De witte onderlaag is nu helemaal af.", algs:[]},
    middle:   {title:"Middelste laag",  desc:"Plaats de vier randen van de middelste laag met de insteek-truc (en de gespiegelde versie voor de andere kant).",
               algs:[{name:"Rechts insteken", seq:"U R U' R' U' F' U F"},{name:"Links insteken", seq:"U' L' U L U F U' F'"}]},
    eo:       {title:"Geel kruis",      desc:"Draai de bovenste randen zodat er bovenop een geel kruis ontstaat. Herhaal de truc tot het kruis er staat.",
               algs:[{name:"Kruis-truc", seq:"F R U R' U' F'"}]},
    co:       {title:"Geel vlak",       desc:"Draai de bovenste hoeken zodat de hele bovenkant geel wordt.",
               algs:[{name:"Sune", seq:"R U R' U R U2 R'"},{name:"Anti-Sune", seq:"R U2 R' U' R U' R'"}]},
    cp:       {title:"Hoeken plaatsen", desc:"Wissel de bovenste hoeken naar hun juiste plek. Het geel staat al goed bovenop.",
               algs:[{name:"Hoekwissel (A-perm)", seq:"R' F R' B2 R F' R' B2 R2"}]},
    ep:       {title:"Randen plaatsen", desc:"Wissel als laatste de bovenste randen om. Daarna is de kubus helemaal opgelost!",
               algs:[{name:"Randwissel (U-perm)", seq:"R U' R U R U R U' R' U' R2"}]},
  };

  // De 2×2: drie fases. {onder}/{boven} worden de kleurnamen van die kubus —
  // een 2×2 heeft geen middens, dus welke kleur onder ligt hangt af van de hoek
  // linksachter onder (die blijft staan, zie pocket.js).
  const join = a => a.join(" ");
  const STAGE_INFO_2 = {
    layer: {title:"Onderlaag",        desc:"De hoek linksachter onder blijft de hele tijd staan. Zet de andere drie onderste hoeken erbij, zodat de onderkant helemaal {onder} is en de zijkanten van de onderlaag kloppen. Dit doe je op gevoel.", algs:[]},
    co:    {title:"Bovenvlak",        desc:"Draai de bovenste hoeken zodat de hele bovenkant {boven} wordt. Herhaal de truc tot het vlak klaar is.",
            algs:[{name:"Sune", seq:join(PK.ALG_SUNE)},{name:"Anti-Sune", seq:join(PK.ALG_ANTISUNE)}]},
    cp:    {title:"Hoeken bovenlaag", desc:"Zet de bovenste hoeken op hun plek; het {boven} blijft bovenop. Staan er twee goed naast elkaar, houd die links: de wissel ruilt de twee rechter hoeken. Staan ze schuin verwisseld, dan is er de schuine wissel. Een laatste draai van de bovenkant en klaar!",
            algs:[{name:"Naast elkaar wisselen (T-perm)", seq:join(PK.ALG_TPERM)},{name:"Schuin wisselen (Y-perm)", seq:join(PK.ALG_YPERM)}]},
  };

  // Alles wat per maat verschilt. read() geeft {state, faceColor} of {error};
  // paint(stand) geeft de kleuren terug in dezelfde volgorde als de invoer.
  const SIZES = {
    3: {
      solved:   ()=>CS.stateToFacelets(CS.solvedState()),
      scramble: ()=>CS.stateToFacelets(CS.applySeq(CS.solvedState(), CS.randomScramble(25))),
      read:     cols=>{ const r = CS.faceletsToState(cols); return r.error ? r : {state:r.state, faceColor:[0,1,2,3,4,5]}; },
      turn:     (st,mv)=>CS.applySeq(st,[mv]),
      paint:    st=>CS.stateToFacelets(st),
      solveLocal: state=>{
        let sol=null;
        try{ if(window.Kociemba){ window.Kociemba.buildTables(); sol=window.Kociemba.solve(state,{maxTime:500}); } }catch(e){}
        if(!sol){ try{ sol=CS.solveCube(state); }catch(e){ sol=null; } }
        return sol;
      },
      stagedLocal: state=>CS.solveStaged(state),
      warmLocal: ()=>{ if(window.Kociemba) window.Kociemba.buildTables(); },
      stageInfo: STAGE_INFO,
      fixedCentre: true,
      hint:      "Draai de kubus met de knoppen, kies een kleur en tik op de vlakjes. De middens staan vast.",
      fastHint:  "Los de kubus in ±20 zetten op.",
      learnHint: "Leer de kubus zelf oplossen: 7 fases met de klassieke trucjes.",
      holdHint:  "",
    },
    2: {
      solved:   ()=>PK.stateToFacelets(PK.solvedState()),
      scramble: ()=>PK.stateToFacelets(PK.randomState()),
      read:     cols=>PK.faceletsToState(cols, COLOR_NAMES),
      turn:     (st,mv)=>PK.applySeq(st,[mv]),
      paint:    (st,fc)=>PK.stateToFacelets(st, fc),
      solveLocal:  state=>PK.solve(state),
      stagedLocal: state=>PK.solveStaged(state),
      warmLocal: ()=>PK.buildTables(),
      stageInfo: STAGE_INFO_2,
      fixedCentre: false,
      hint:      "Houd je kubus vast zoals op het scherm, kies een kleur en tik op de vlakjes. Draai met de knoppen om de andere kanten te zien.",
      fastHint:  "Los de 2×2 in de kortste route op (hooguit 11 zetten).",
      learnHint: "Leer de 2×2 zelf oplossen: 3 fases met de beginnerstrucjes.",
      holdHint:  " Houd je kubus zoals op het scherm.",
    },
  };
  const cfg = ()=>SIZES[N];

  // DOM ----------------------------------------------------------------------
  const $ = id => document.getElementById(id);

  function buildPalette(){
    const wrap = $("palette");
    wrap.innerHTML = "";
    COLORS.forEach((c,i)=>{
      const b = document.createElement("button");
      b.className = "swatch"+(i===selectedColor?" sel":"");
      b.style.background = c;
      b.title = COLOR_NAMES[i];
      b.onclick = ()=>{ selectedColor=i; buildPalette(); };
      wrap.appendChild(b);
    });
  }

  function faceBase(key){ return FACE_KEYS.indexOf(key)*N*N; }

  // map a facelet (face,row,col) of an n×n cube to a cubie position (CSS
  // coords, centred: h = (n-1)/2 is the outer layer) — matches the solver's
  // facelet layout so colouring corresponds 1:1 with a real cube.
  function faceletCubie(key,r,c,n){
    const h = (n-1)/2;
    switch(key){
      case "U": return [c-h, -h, r-h];
      case "D": return [c-h,  h, h-r];
      case "F": return [c-h, r-h,  h];
      case "B": return [h-c, r-h, -h];
      case "R": return [ h, r-h, h-c];
      case "L": return [-h, r-h, c-h];
    }
  }

  // Build the cubies of an N×N×N cube and the facelet->pad lookup.
  function buildCube(){
    const cube = $("cube");
    cube.innerHTML = "";
    for(const k in cubies) delete cubies[k];
    const h = (N-1)/2;
    const outward = { // for cubie (x,y,z): is the <dir> side outward?
      U:(x,y,z)=>y===-h, D:(x,y,z)=>y===h, F:(x,y,z)=>z===h,
      B:(x,y,z)=>z===-h, R:(x,y,z)=>x===h, L:(x,y,z)=>x===-h,
    };
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
      const x=i-h, y=j-h, z=k-h;
      if(Math.abs(x)<h && Math.abs(y)<h && Math.abs(z)<h) continue;   // binnenin
      const cubie = document.createElement("div");
      cubie.className = "cubie";
      cubie.style.transform = cubieTransform(x,y,z);
      for(const dir of FACE_KEYS){
        const cf = document.createElement("div");
        cf.className = "cf cf-"+dir;
        if(outward[dir](x,y,z)){
          const pad = document.createElement("div");
          pad.className = "pad";
          cf.appendChild(pad);
        }
        cubie.appendChild(cf);
      }
      cubies[x+","+y+","+z] = cubie;
      cube.appendChild(cubie);
    }
    // link each facelet to its coloured pad + wire up editing
    padRef = new Array(6*N*N);
    for(const key of FACE_KEYS){
      const base = faceBase(key);
      for(let i=0;i<N*N;i++){
        const r=(i/N)|0, c=i%N;
        const [x,y,z] = faceletCubie(key,r,c,N);
        const pad = cubies[x+","+y+","+z].querySelector(".cf-"+key+" .pad");
        const idx = base+i;
        padRef[idx] = pad;
        pad.dataset.idx = idx;
        if(isFixed(idx)) pad.classList.add("fixed");
        else pad.onclick = ()=>onSticker(idx);
      }
    }
    applyView();
    paintCube();
  }

  // the 3×3 centres can't be recoloured (they define the colour scheme)
  function isFixed(idx){ return cfg().fixedCentre && idx%9===4; }

  function cubieTransform(x,y,z){
    return "translate3d(calc(var(--cu)*"+x+"),calc(var(--cu)*"+y+"),calc(var(--cu)*"+z+"))";
  }

  function colorsForRender(){
    return mode==="edit" ? inputColors : frames[stepIndex];
  }
  function paintCube(){
    const cols = colorsForRender();
    for(let i=0;i<padRef.length;i++){ if(padRef[i]) padRef[i].style.background = COLORS[cols[i]] || "#2a2a2d"; }
    // highlight the stickers of the face the current move turns
    for(let i=0;i<padRef.length;i++){ if(padRef[i]) padRef[i].classList.remove("turn"); }
    if(mode==="solve" && stepIndex < solution.length){
      const key = solution[stepIndex][0];
      const base = faceBase(key);
      for(let i=0;i<N*N;i++){ if(padRef[base+i]) padRef[base+i].classList.add("turn"); }
    }
  }

  // view rotation -----------------------------------------------------------
  function applyView(){
    const cube = $("cube");
    cube.style.setProperty("--rx", viewRX+"deg");
    cube.style.setProperty("--ry", viewRY+"deg");
  }
  function rotateView(dx,dy){ viewRX+=dx; viewRY+=dy; applyView(); }
  // reset naar de standaard 3/4-kijkhoek (geel boven, groen voor, oranje rechts)
  function resetView(){ viewRX = 0; viewRY = 0; applyView(); }

  function onSticker(idx){
    if(mode!=="edit") return;
    if(isFixed(idx)) return;
    inputColors[idx]=selectedColor;
    paintCube();
  }

  // ---- animated layer turn -------------------------------------------------
  // Rotate the cubies of `mv`'s layer, then bake (snap back + recolour) by
  // calling done(). Cubies stay at fixed positions; we only animate the visual
  // turn and then repaint to the next state.
  function animateTurn(mv, done){
    const face = mv[0];
    const a = MOVE_ANIM[face];
    const amt = mv[1]==="'" ? -1 : mv[1]==="2" ? 2 : 1;
    const deg = a.deg*amt;
    const cube = $("cube");
    const layer = document.createElement("div");
    layer.className = "layer";
    cube.appendChild(layer);
    const moved = [];
    for(const k in cubies){
      const [x,y,z] = k.split(",").map(Number);
      if(a.sel(x,y,z)){ layer.appendChild(cubies[k]); moved.push(cubies[k]); }
    }
    // force a reflow so the starting transform is registered before we animate
    void layer.offsetWidth;
    layer.style.transform = "rotate"+a.axis+"("+deg+"deg)";
    let finished = false;
    const finish = ()=>{
      if(finished) return; finished = true;
      // move cubies back to the cube (their per-cubie transforms are unchanged)
      for(const c of moved) cube.appendChild(c);
      layer.remove();
      done();
    };
    layer.addEventListener("transitionend", finish, {once:true});
    setTimeout(finish, TURN_MS+120);  // safety net if transitionend doesn't fire
  }

  // actions ------------------------------------------------------------------
  function reset(){
    stopPlay();
    inputColors = cfg().solved();
    setMode("edit");
    setStatus("");
    paintCube();
  }
  function scramble(){
    stopPlay();
    inputColors = cfg().scramble();
    setMode("edit");
    setStatus("Door elkaar gegooid – druk op Los op!");
    paintCube();
  }

  // Run the (heavy) solve off the main thread when possible so the page never
  // freezes. For the 3×3 the worker uses the Kociemba two-phase solver (~20-move
  // solutions) and falls back to the layer-by-layer solver if needed; for the
  // 2×2 it looks the shortest route up in Pocket's distance table.
  let worker, solveCallback=null, stagedCallback=null;
  // Runs inside the Worker, after solver.js, kociemba.js and pocket.js (which
  // are put in front of it as text). Uses only their globals — nothing from
  // this closure exists there.
  function workerMain(){
    self.onmessage = function(e){
      var d = e.data, r = null;
      if(d.n===2){
        try{
          if(d.type==="warmup") Pocket.buildTables();
          else r = d.type==="staged" ? Pocket.solveStaged(d.state) : Pocket.solve(d.state);
        }catch(_){ r = null; }
      } else if(d.type==="warmup"){
        try{ Kociemba.buildTables(); }catch(_){}
      } else if(d.type==="staged"){
        try{ r = solveStaged(d.state); }catch(_){ r = null; }
      } else {
        try{ Kociemba.buildTables(); r = Kociemba.solve(d.state,{maxTime:500}); if(!r) r = solveCube(d.state); }
        catch(_){ try{ r = solveCube(d.state); }catch(e2){ r = null; } }
      }
      postMessage(d.type==="staged" ? {type:"staged", res:r} :
                  d.type==="warmup" ? {type:"warmup"} : {type:"solve", sol:r});
    };
  }
  function getWorker(){
    if(worker!==undefined) return worker;
    try{
      const src = ["solver-src","kociemba-src","pocket-src"]
        .map(id=>document.getElementById(id).textContent).join("\n") +
        "\n(" + workerMain.toString() + ")();";
      const url = URL.createObjectURL(new Blob([src],{type:"application/javascript"}));
      worker = new Worker(url);
      worker.onmessage = (e)=>{
        const d = e.data;
        if(d.type==="solve" && solveCallback){ const cb=solveCallback; solveCallback=null; cb(d.sol); }
        else if(d.type==="staged" && stagedCallback){ const cb=stagedCallback; stagedCallback=null; cb(d.res); }
      };
    }catch(e){ worker = null; }
    return worker;
  }

  // one solve job, in the worker or (no Workers) on the main thread
  function runJob(type, job, cb){
    const w = getWorker();
    if(w){
      if(type==="staged") stagedCallback = cb; else solveCallback = cb;
      w.postMessage({type, n:job.n, state:job.state});
      return;
    }
    const local = type==="staged" ? SIZES[job.n].stagedLocal : SIZES[job.n].solveLocal;
    setTimeout(()=>{ let r=null; try{ r=local(job.state); }catch(e){ r=null; } cb(r); }, 30);
  }

  // build the heavy tables of a size in the background, so its first solve is fast
  const warmed = {};
  function warmup(n){
    if(warmed[n]) return;
    warmed[n] = true;
    const w = getWorker();
    if(w) w.postMessage({type:"warmup", n});
    else { try{ SIZES[n].warmLocal(); }catch(e){} }
  }

  // build the per-step colour frames from the current `solution`; frames[i] is
  // the cube after i moves. frames[0] = painter(start) = exactly the entered
  // colours (test/solver.test.js checks that round trip for both sizes).
  function buildFrames(startState){
    let st = startState;
    frames = [painter(st)];
    for(const mv of solution){ st = cfg().turn(st, mv); frames.push(painter(st)); }
  }

  function solve(){
    const btn = $("solveBtn");
    if(btn.disabled) return;              // een solve loopt al
    const c = cfg(), res = c.read(inputColors);
    if(res.error){ setStatus("⚠ "+res.error, true); return; }
    btn.disabled = true;
    const fc = res.faceColor;
    const job = {n:N, state:res.state, faceColor:fc, paint:st=>c.paint(st, fc)};
    if(solveMode==="learn") solveLearn(job);
    else solveFast(job);
  }

  // the result of a job arrived: take it over, unless the size was switched
  function accept(job){
    $("solveBtn").disabled = false;
    if(job.n!==N) return false;
    painter = job.paint;
    faceColor = job.faceColor;
    return true;
  }

  // ⚡ snelle oplossing (3×3: Kociemba ±20 zetten, 2×2: de kortste), één vlakke zettenlijst
  function solveFast(job){
    setStatus("Bezig met oplossen…");
    runJob("solve", job, (sol)=>{
      if(!accept(job)) return;
      if(sol===null||sol===undefined){ setStatus("⚠ Deze kubus kan niet opgelost worden.", true); return; }
      solution = sol;
      stages = []; stageOf = [];
      buildFrames(job.state);
      stepIndex = 0;
      setMode("solve");
      renderSolution();
      setStatus(sol.length===0 ? "Deze kubus is al opgelost! 🎉"
                               : "Opgelost in "+sol.length+" zetten 🎉"+cfg().holdHint);
      resetView();
      afterStep();
    });
  }

  // 📚 leer-oplossing: dezelfde kubus, opgesplitst in aanleerbare fases
  function solveLearn(job){
    setStatus("Leerroute berekenen…");
    runJob("staged", job, (staged)=>{
      if(!accept(job)) return;
      if(!staged || !staged.stages){ setStatus("⚠ Deze kubus kan niet opgelost worden.", true); return; }
      setupStaged(staged);
      buildFrames(job.state);
      stepIndex = 0;
      setMode("solve");
      renderSolution();
      const nStages = stages.filter(s=>s.count>0).length;
      setStatus(solution.length===0 ? "Deze kubus is al opgelost! 🎉"
                                    : "Leerroute klaar — "+solution.length+" zetten in "+nStages+" fases."+cfg().holdHint);
      resetView();
      afterStep();
    });
  }

  // {boven}/{onder} in de 2×2-uitleg -> kleurnaam van dat vlak van deze kubus
  function fillColors(t){
    return t.replace(/\{boven\}/g, COLOR_NAMES[faceColor[0]].toLowerCase())
            .replace(/\{onder\}/g, COLOR_NAMES[faceColor[3]].toLowerCase());
  }

  // turn a staged result into `stages` (with move-index bounds) + `stageOf`
  function setupStaged(staged){
    solution = staged.moves.slice();
    stages = []; stageOf = [];
    let idx = 0;
    staged.stages.forEach((st, si)=>{
      const info = cfg().stageInfo[st.key] || {title:st.key, desc:"", algs:[]};
      const start = idx, count = st.moves.length;
      stages.push({key:st.key, title:info.title, desc:fillColors(info.desc), algs:info.algs||[],
                   start, end:start+count, count});
      for(let k=0;k<count;k++) stageOf[idx++] = si;
    });
  }

  // solution rendering -------------------------------------------------------
  function makeChip(i){
    const chip = document.createElement("span");
    chip.className = "movechip";
    chip.textContent = solution[i];
    chip.dataset.i = i;
    chip.onclick = ()=>{ if(animating) return; stopPlay(); snapTo(i); };
    return chip;
  }
  function renderSolution(){
    const list = $("movelist");
    list.innerHTML = "";
    if(solveMode==="learn" && stages.length){
      stages.forEach((st, si)=>{
        if(st.count===0) return;              // overgeslagen fase (al klaar)
        const sep = document.createElement("div");
        sep.className = "stagesep";
        sep.textContent = (si+1)+". "+st.title;
        list.appendChild(sep);
        for(let i=st.start;i<st.end;i++) list.appendChild(makeChip(i));
      });
    } else {
      for(let i=0;i<solution.length;i++) list.appendChild(makeChip(i));
    }
    updateChips();
    updateMoveInfo();
    renderStageHeader();
  }

  // which stage is "current" for the header (stages.length == everything done)
  function currentStageIndex(){
    if(!stages.length) return -1;
    if(stepIndex>=solution.length) return stages.length;
    return stageOf[stepIndex];
  }

  function renderStageHeader(){
    const h = $("stageHeader");
    if(!h) return;
    if(solveMode!=="learn" || !stages.length){ h.style.display="none"; return; }
    h.style.display="block";
    const csi = currentStageIndex();
    let html = '<div class="stagepills">';
    stages.forEach((st,i)=>{
      const done = st.count>0 ? stepIndex>=st.end : csi>i;
      const cur  = i===csi && csi<stages.length;
      html += '<button class="stagepill'+(cur?' cur':(done?' done':''))+'" data-si="'+i+'">'+
              ((done&&!cur)?'✓':(i+1))+'</button>';
    });
    html += '</div>';
    if(csi>=stages.length){
      html += '<div class="stagetitle">🎉 Helemaal opgelost!</div>'+
              '<div class="stagedesc">Je hebt alle fases doorlopen. Druk op ✎ om het nog eens te oefenen.</div>';
    } else {
      const st = stages[csi];
      html += '<div class="stagephase">Fase '+(csi+1)+' van '+stages.length+'</div>'+
              '<div class="stagetitle">'+st.title+'</div>'+
              '<div class="stagedesc">'+st.desc+'</div>';
      if(st.algs && st.algs.length){
        html += '<div class="stagealgs">';
        st.algs.forEach(a=>{ html += '<div class="algrow"><span class="algname">'+a.name+
                                     '</span><span class="algseq">'+a.seq+'</span></div>'; });
        html += '</div>';
      } else {
        html += '<div class="algnote">Geen vast algoritme — plaats de stukken op gevoel en volg de zetten.</div>';
      }
    }
    h.innerHTML = html;
    h.querySelectorAll(".stagepill").forEach(b=>{
      b.onclick = ()=>{ if(animating) return; stopPlay(); snapTo(stages[+b.dataset.si].start); };
    });
  }
  function updateChips(){
    document.querySelectorAll(".movechip").forEach(c=>{
      const i=+c.dataset.i;
      c.classList.toggle("done", i<stepIndex);
      c.classList.toggle("current", i===stepIndex);
    });
  }
  function updateMoveInfo(){
    const info = $("moveinfo");
    if(stepIndex<solution.length){
      const mv = solution[stepIndex];
      info.innerHTML = '<span class="bignote">'+mv+'</span>'+
                       '<span class="bigtext">'+(MOVE_TEXT[mv]||"")+'</span>'+
                       '<span class="bigsub">Druk op ▶ en draai precies mee met de kubus</span>'+
                       '<span class="counter">Zet '+(stepIndex+1)+' / '+solution.length+'</span>';
    } else {
      info.innerHTML = '<span class="bignote">✓</span><span class="bigtext">Klaar! De kubus is opgelost.</span>';
    }
  }
  // settle on a step without animating the turn (used for prev / jumps)
  function afterStep(){
    updateChips(); updateMoveInfo();
    if(solveMode==="learn") renderStageHeader();
    paintCube();
  }
  function snapTo(i){
    stepIndex = Math.max(0, Math.min(frames.length-1, i));
    afterStep();
  }

  // advance one move WITH animation
  function advance(){
    if(animating) return;
    if(stepIndex>=solution.length){ return; }
    const mv = solution[stepIndex];
    // de kubus blijft staan; alleen de laag draait (in de huidige kijkhoek)
    animating = true;
    animateTurn(mv, ()=>{
      animating = false;
      stepIndex++;
      afterStep();
      if(playing){
        if(stepIndex>=solution.length){ stopPlay(); }
        else { playTimer = setTimeout(advance, 350); }
      }
    });
  }

  function step(d){
    stopPlay();
    if(animating) return;
    if(d>0){ advance(); return; }            // forward = animated turn
    snapTo(stepIndex+d);                      // backward = snap
  }
  function gotoStart(){ stopPlay(); if(animating) return; snapTo(0); }
  function gotoEnd(){ stopPlay(); if(animating) return; snapTo(frames.length-1); }

  function play(){
    if(playing){ stopPlay(); return; }
    if(stepIndex>=solution.length) snapTo(0);
    playing=true; $("playBtn").textContent="⏸ Pauze";
    advance();
  }
  function stopPlay(){
    playing=false; if(playTimer){ clearTimeout(playTimer); playTimer=null; }
    const pb=$("playBtn"); if(pb) pb.textContent="▶ Speel af";
  }

  // mode / ui ----------------------------------------------------------------
  function setMode(m){
    mode=m;
    $("editControls").style.display = m==="edit"?"block":"none";
    $("solvePanel").style.display = m==="solve"?"block":"none";
    $("paletteWrap").style.display = m==="edit"?"block":"none";
    document.body.classList.toggle("solving", m==="solve");
    document.body.classList.toggle("learnmode", m==="solve" && solveMode==="learn");
    if(m!=="solve"){ const h=$("stageHeader"); if(h) h.style.display="none"; }
  }
  // snel vs. leren — bepaalt wat "Los op!" doet (alleen instelbaar in edit)
  function setSolveMode(m){
    solveMode = m;
    document.querySelectorAll("#modeSeg button").forEach(b=>b.classList.toggle("active", b.dataset.m===m));
    $("solveBtn").textContent = m==="learn" ? "📚 Leer oplossen" : "✨ Los op!";
    $("modeHint").textContent = m==="learn" ? cfg().learnHint : cfg().fastHint;
  }

  // 3×3 of 2×2. De ingevoerde kleuren van elke maat blijven bewaard; de keuze
  // geldt per toestel (localStorage) en #2x2 in het adres opent direct de 2×2.
  const SIZE_KEY = "spellenhoek:kubus-maat";
  function setSize(n){
    if(animating) return;
    stopPlay();
    if(inputColors) inputBySize[N] = inputColors;
    N = n;
    inputColors = inputBySize[N] || cfg().solved();
    document.body.classList.toggle("n2", N===2);
    document.querySelectorAll("#sizeSeg button").forEach(b=>b.classList.toggle("active", +b.dataset.n===N));
    $("paletteHint").textContent = cfg().hint;
    try{ localStorage.setItem(SIZE_KEY, String(N)); }catch(e){}
    try{ history.replaceState(null, "", N===2 ? "#2x2" : location.pathname+location.search); }catch(e){}
    setMode("edit");
    setSolveMode(solveMode);
    setStatus("");
    viewRX = 0; viewRY = 0;
    buildCube();
    setTimeout(()=>warmup(N), 200);
  }
  function initialSize(){
    if(location.hash==="#2x2") return 2;
    if(location.hash==="#3x3") return 3;
    try{ if(localStorage.getItem(SIZE_KEY)==="2") return 2; }catch(e){}
    return 3;
  }
  function setStatus(t, warn){
    const s=$("status"); s.textContent=t||""; s.classList.toggle("warn", !!warn);
  }

  // init ---------------------------------------------------------------------
  function init(){
    buildPalette();
    $("scrambleBtn").onclick = scramble;
    $("resetBtn").onclick = reset;
    $("solveBtn").onclick = solve;
    document.querySelectorAll("#modeSeg button").forEach(b=>{ b.onclick = ()=>setSolveMode(b.dataset.m); });
    document.querySelectorAll("#sizeSeg button").forEach(b=>{ b.onclick = ()=>{ if(+b.dataset.n!==N) setSize(+b.dataset.n); }; });
    setSolveMode("fast");
    $("rotSide").onclick = ()=>rotateView(0,-90);
    $("rotUp").onclick = ()=>rotateView(90,0);
    $("editBtn").onclick = ()=>{ stopPlay(); setMode("edit"); setStatus(""); paintCube(); };
    $("firstBtn").onclick = gotoStart;
    $("prevBtn").onclick = ()=>step(-1);
    $("nextBtn").onclick = ()=>step(1);
    $("lastBtn").onclick = gotoEnd;
    $("playBtn").onclick = play;
    setSize(initialSize());     // bouwt de kubus en warmt zijn oplosser op
  }
  if(document.readyState!=="loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
