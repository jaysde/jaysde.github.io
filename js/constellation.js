/* Neural-network background: drifting nodes linked by faint lines, with
   signal pulses that travel along links and make nodes blink on arrival
   (sometimes chaining to a neighbour, like neural firing).
   Looks for a <canvas id="bg-net">. Skipped on small screens and for
   prefers-reduced-motion; paused when the tab is hidden. */
(function () {
  var canvas = document.getElementById('bg-net');
  if (!canvas) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || window.innerWidth < 700) return;

  var ctx = canvas.getContext('2d');
  var w, h, dpr, pts, pulses, raf, running = true, tick = 0;
  var MAX = 140;          // link distance
  var MAX_PULSES = 9;     // concurrent signals
  var PX_PER_FRAME = 1.8; // pulse speed
  var NAV = 70;           // fixed navbar height; bands start below it
  var SEQ = 2600;         // frames for one full payload cycle (calm pace)
  function sm(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var scene = {};         // per-frame choreography state (filled by computeScene)
  var HB = 3.5;           // payload box half-size
  var phaseBase = 0;      // lets a click fast-forward the cycle to launch
  function phase() { return ((((tick - phaseBase) % SEQ) + SEQ) % SEQ) / SEQ; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function neighbors(i) {
    var res = [], a = pts[i], dx, dy;
    for (var j = 0; j < pts.length; j++) {
      if (j === i) continue;
      dx = a.x - pts[j].x; dy = a.y - pts[j].y;
      if (dx * dx + dy * dy < MAX * MAX) res.push(j);
    }
    return res;
  }
  function init() {
    resize();
    var count = Math.max(24, Math.min(70, Math.round(w * h / 20000)));
    pts = [];
    for (var i = 0; i < count; i++) {
      pts.push({ x: Math.random() * w, y: Math.random() * h,
                 vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, glow: 0 });
    }
    pulses = [];
  }
  function spawnPulse(from) {
    if (pulses.length >= MAX_PULSES || !pts.length) return;
    var i = (from == null) ? (Math.random() * pts.length | 0) : from;
    var ns = neighbors(i);
    if (!ns.length) return;
    var to = ns[(Math.random() * ns.length) | 0];
    var a = pts[i], b = pts[to];
    var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) || 1;
    pulses.push({ i: i, to: to, t: 0, speed: PX_PER_FRAME / d });
  }
  /* Robot arm at the bottom-right. Reaches a target supplied by the scene
     (rest pose, or the box on the rover) via 2-link inverse kinematics. */
  function drawArm() {
    var bx = scene.armBaseX, by = scene.armBaseY, L1 = 80, L2 = 62, L3 = 26;
    var Tgx = scene.armTargetX, Tgy = scene.armTargetY;
    var Wx = Tgx, Wy = Tgy - L3;                       // gripper points straight down
    var dx = Wx - bx, dy = Wy - by;
    var D = Math.min(Math.sqrt(dx * dx + dy * dy), L1 + L2 - 0.5);
    var c2 = (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2); c2 = c2 < -1 ? -1 : c2 > 1 ? 1 : c2;
    var th2 = -Math.acos(c2);
    var th1 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(th2), L1 + L2 * Math.cos(th2));
    var A1 = th1, A2 = th1 + th2;

    var j0 = { x: bx, y: by };
    var j1 = { x: j0.x + Math.cos(A1) * L1, y: j0.y + Math.sin(A1) * L1 };
    var j2 = { x: j1.x + Math.cos(A2) * L2, y: j1.y + Math.sin(A2) * L2 };
    var j3 = { x: Tgx, y: Tgy };

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(j0.x, j0.y); ctx.lineTo(j1.x, j1.y); ctx.lineTo(j2.x, j2.y); ctx.lineTo(j3.x, j3.y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(bx - 15, by + 7); ctx.lineTo(bx + 15, by + 7);
    ctx.lineTo(bx + 9, by - 6); ctx.lineTo(bx - 9, by - 6);
    ctx.closePath(); ctx.fill();

    var joints = [j0, j1, j2];
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    for (var i = 0; i < joints.length; i++) {
      ctx.beginPath(); ctx.arc(joints[i].x, joints[i].y, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    // claws sit just outside the box when closed, so no lines overlap the box
    var openAmt = (HB + 2) + scene.gripOpen * 4.5, gl = HB + 4;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(j3.x - openAmt, j3.y); ctx.lineTo(j3.x + openAmt, j3.y);
    ctx.moveTo(j3.x - openAmt, j3.y); ctx.lineTo(j3.x - openAmt, j3.y + gl);
    ctx.moveTo(j3.x + openAmt, j3.y); ctx.lineTo(j3.x + openAmt, j3.y + gl);
    ctx.stroke();
  }

  /* Satellite tracing a slow elliptical orbit (top-right). */
  function drawSatellite(k) {
    var cx = w - 94, cy = Math.round(NAV + (h - NAV) * 0.125), orx = 52, ory = 34;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, orx, ory, 0, 0, Math.PI * 2); ctx.stroke();
    var ang = k * 0.012;
    var sx = cx + Math.cos(ang) * orx, sy = cy + Math.sin(ang) * ory;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(-3, -3, 6, 6);                 // body
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
    ctx.strokeRect(-15, -3, 8, 6); ctx.strokeRect(7, -3, 8, 6); // solar panels
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-3, 0); ctx.moveTo(3, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.restore();
  }

  /* Mars rover — position/facing come from the scene choreography. */
  function drawRover() {
    var rx = scene.roverX, ry = scene.roverRy, face = scene.roverFace;
    ctx.save(); ctx.translate(rx, ry); ctx.scale(face, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeRect(-18, -12, 36, 10);           // body (flat deck to carry the box)
    ctx.beginPath(); ctx.moveTo(8, -12); ctx.lineTo(8, -22); ctx.lineTo(14, -22); ctx.stroke(); // mast
    ctx.fillRect(13, -24, 4, 4);                // camera head
    ctx.beginPath(); ctx.moveTo(-14, 2); ctx.lineTo(0, -2); ctx.lineTo(14, 2); ctx.stroke();    // rocker
    var sp = tick * 0.08;
    for (var wx = -14; wx <= 14; wx += 14) {
      ctx.beginPath(); ctx.arc(wx, 2, 4.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, 2); ctx.lineTo(wx + Math.cos(sp) * 4.4, 2 + Math.sin(sp) * 4.4); ctx.stroke();
    }
    ctx.restore();
  }

  /* The payload box (drawn wherever the scene says it currently is). */
  function drawBox() {
    if (!scene.boxVisible) return;
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.fillRect(scene.boxX - HB, scene.boxY - HB, HB * 2, HB * 2);
    ctx.strokeRect(scene.boxX - HB, scene.boxY - HB, HB * 2, HB * 2);
  }

  /* GPU die with a grid of cores that flicker like active compute (right side). */
  function drawGPU(k) {
    var gw = 66, gh = 66, gx = 26, gy = Math.round(NAV + (h - NAV) * 0.22 - gh / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    for (var i = 1; i < 6; i++) {
      var px = gx + i * gw / 6, py = gy + i * gh / 6;
      ctx.beginPath(); ctx.moveTo(px, gy - 5); ctx.lineTo(px, gy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, gy + gh); ctx.lineTo(px, gy + gh + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx - 5, py); ctx.lineTo(gx, py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx + gw, py); ctx.lineTo(gx + gw + 5, py); ctx.stroke();
    }
    var pad = 13, n = 5, cell = (gw - pad * 2) / n;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var lit = Math.sin(k * 0.05 + (r * n + c) * 1.3) > 0.4;
        ctx.fillStyle = lit ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.09)';
        ctx.fillRect(gx + pad + c * cell + 1, gy + pad + r * cell + 1, cell - 3, cell - 3);
      }
    }
  }

  /* Rocket booster (bottom-left). Landed/launch state comes from the scene;
     carries the payload box up when launching. */
  function drawBooster() {
    var px = scene.padX, topY = Math.round(NAV + (h - NAV) * 0.42), padY = h - 34;
    var d = scene.boosterD, flame = scene.boosterFlame;
    var by = topY + (padY - topY) * d;
    var bw = 12, bh = 44;
    ctx.save(); ctx.translate(px, by);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeRect(-bw / 2, -bh, bw, bh);
    ctx.beginPath(); ctx.moveTo(-bw / 2, -bh); ctx.lineTo(0, -bh - 9); ctx.lineTo(bw / 2, -bh); ctx.stroke();
    ctx.strokeRect(-bw / 2 - 5, -bh + 6, 5, 7); ctx.strokeRect(bw / 2, -bh + 6, 5, 7);
    var legf = Math.min(1, Math.max(0, (d - 0.6) / 0.4));
    ctx.beginPath();
    ctx.moveTo(-bw / 2, 0); ctx.lineTo(-bw / 2 - legf * 9, legf * 12);
    ctx.moveTo(bw / 2, 0); ctx.lineTo(bw / 2 + legf * 9, legf * 12); ctx.stroke();
    if (scene.boosterBox) {                        // payload inside the fairing (upper body)
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(-HB, -bh + 10 - HB, HB * 2, HB * 2);
    }
    if (flame) {
      var fl = 10 + (Math.sin(tick * 0.5) + 1) * 4;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, fl); ctx.lineTo(5, 0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px - 18, padY + 12); ctx.lineTo(px + 18, padY + 12); ctx.stroke(); // pad
  }

  /* Choreography: box rover -> arm -> rover -> rocket -> launch, on one loop. */
  function computeScene() {
    var p = phase();
    var roverRy = h - 22, homeX = 128, pickupX = w - 176;
    var armBaseX = w - 56, armBaseY = h - 40;
    var boxOnRover = roverRy - 12 - HB;             // resting on the rover deck
    var heldDY = HB + 3;                            // box centre below the gripper tip
    var restX = armBaseX - 72, restY = armBaseY - 78;
    var padX = 84, padY = h - 34;

    var s = {
      roverX: homeX, roverFace: 1, roverRy: roverRy,
      armBaseX: armBaseX, armBaseY: armBaseY, armTargetX: restX, armTargetY: restY, gripOpen: 1,
      boxX: homeX, boxY: boxOnRover, boxVisible: true,
      boosterD: 1, boosterFlame: false, boosterBox: false, padX: padX
    };
    var boxTx = pickupX, boxTy = boxOnRover;         // box resting on rover under the arm
    var liftX = pickupX, liftY = armBaseY - 44;      // raised pick point

    if (p < 0.03) {                                  // brief idle after landing
      // defaults
    } else if (p < 0.34) {                           // rover carries box out to the arm
      var t = sm((p - 0.03) / 0.31);
      s.roverX = lerp(homeX, pickupX, t); s.roverFace = 1; s.boxX = s.roverX;
    } else if (p < 0.40) {                           // arm descends to the box & grips
      s.roverX = pickupX;
      var t2 = sm((p - 0.34) / 0.06);
      s.armTargetX = lerp(restX, boxTx, t2); s.armTargetY = lerp(restY, boxTy, t2);
      s.gripOpen = 1 - sm((p - 0.375) / 0.025); s.boxX = pickupX;
    } else if (p < 0.46) {                            // lift the box
      s.roverX = pickupX;
      var t3 = sm((p - 0.40) / 0.06);
      s.armTargetX = lerp(boxTx, liftX, t3); s.armTargetY = lerp(boxTy, liftY, t3);
      s.gripOpen = 0; s.boxX = s.armTargetX; s.boxY = s.armTargetY + heldDY;
    } else if (p < 0.54) {                            // place it back on the rover & release
      s.roverX = pickupX;
      var t4 = sm((p - 0.46) / 0.08);
      s.armTargetX = lerp(liftX, boxTx, t4); s.armTargetY = lerp(liftY, boxTy, t4);
      s.gripOpen = p > 0.515 ? sm((p - 0.515) / 0.025) : 0;
      if (p > 0.52) { s.boxX = pickupX; s.boxY = boxOnRover; }
      else { s.boxX = s.armTargetX; s.boxY = s.armTargetY + heldDY; }
    } else if (p < 0.56) {                            // arm retracts to rest
      s.roverX = pickupX;
      var t5 = sm((p - 0.54) / 0.02);
      s.armTargetX = lerp(boxTx, restX, t5); s.armTargetY = lerp(boxTy, restY, t5);
      s.boxX = pickupX;
    } else if (p < 0.80) {                            // rover carries box back to the rocket
      var t6 = sm((p - 0.56) / 0.24);
      s.roverX = lerp(pickupX, homeX, t6); s.roverFace = -1; s.boxX = s.roverX;
    } else if (p < 0.86) {                            // load box into the booster (upper body)
      s.roverX = homeX;
      var t7 = sm((p - 0.80) / 0.06);
      s.boxX = lerp(homeX, padX, t7); s.boxY = lerp(boxOnRover, padY - 34, t7);
    } else if (p < 0.95) {                            // launch, carrying the payload up
      s.roverX = homeX; s.boxVisible = false;
      s.boosterD = 1 - sm((p - 0.86) / 0.09); s.boosterFlame = true; s.boosterBox = true;
    } else {                                          // booster returns empty & lands
      s.roverX = homeX; s.boxVisible = false;
      s.boosterD = sm((p - 0.95) / 0.05); s.boosterFlame = true;
    }
    scene = s;
  }

  function frame() {
    if (!running) return;
    tick++;
    ctx.clearRect(0, 0, w, h);
    var i, j, p, a, b, dx, dy, d, o, pu, x, y, r, alpha;

    for (i = 0; i < pts.length; i++) {
      p = pts[i]; p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      if (p.glow > 0) { p.glow -= 0.02; if (p.glow < 0) p.glow = 0; }
    }
    for (i = 0; i < pts.length; i++) {
      for (j = i + 1; j < pts.length; j++) {
        a = pts[i]; b = pts[j]; dx = a.x - b.x; dy = a.y - b.y;
        d = Math.sqrt(dx * dx + dy * dy);
        if (d < MAX) {
          o = (1 - d / MAX) * 0.12;
          ctx.strokeStyle = 'rgba(255,255,255,' + o + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (i = pulses.length - 1; i >= 0; i--) {
      pu = pulses[i]; a = pts[pu.i]; b = pts[pu.to];
      pu.t += pu.speed;
      if (pu.t >= 1) {
        b.glow = 1;
        pulses.splice(i, 1);
        if (Math.random() < 0.6) spawnPulse(pu.to); // chain / fire onward
        continue;
      }
      x = a.x + (b.x - a.x) * pu.t; y = a.y + (b.y - a.y) * pu.t;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    if (tick % 38 === 0) spawnPulse(null);

    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      r = 1.4 + p.glow * 2.2;
      alpha = 0.45 + p.glow * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (p.glow > 0.05) {
        ctx.fillStyle = 'rgba(255,255,255,' + (p.glow * 0.12) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.fill();
      }
    }

    computeScene();
    drawSatellite(tick);
    drawGPU(tick);
    drawBooster();
    drawRover();
    drawBox();
    drawArm();

    raf = requestAnimationFrame(frame);
  }

  init();
  spawnPulse(null); spawnPulse(null);
  raf = requestAnimationFrame(frame);
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(init, 200); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
  });

  /* Click the landed rocket to launch it immediately (jump the cycle to load/launch). */
  window.addEventListener('click', function (e) {
    if (phase() >= 0.80) return;                 // already loading / launching / returning
    var padX = 84, padY = h - 34;
    if (e.clientX >= padX - 24 && e.clientX <= padX + 24 &&
        e.clientY >= padY - 72 && e.clientY <= padY + 12) {
      phaseBase = tick - Math.round(0.80 * SEQ); // fast-forward to the launch sequence
    }
  });
})();
