import { SEAT, HIP, SHOULDER, HEAD, HEAD_R, THIGH, SHIN, bodyPoint, armPoints } from './rider-geometry.js';
import { groundY } from './terrain.js';

const MENU_ROW = 36; // px, height of a level's row in the menu

/** Screen y of the menu's row for a level, px. */
export function menuRowY(height, index) {
  return height * 0.4 + index * MENU_ROW;
}

/** First menu row containing y; exact row boundaries do not select a level. */
export function menuRowAt(height, count, y) {
  for (let i = 0; i < count; i++) {
    if (Math.abs(y - menuRowY(height, i)) < MENU_ROW / 2) return i;
  }
  return -1;
}

export function render(ctx, viewport, s, p, ui) {
  const { w, h, dpr } = viewport;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = Math.min(w, h * 1.6) / 9; // px per meter; 1.5× wider world view, HUD stays unscaled
  const baseY = h * 0.72;
  // camera follows the rider on both axes: the wheel's bottom sits at baseY
  const camX = s.x, camY = s.y - p.wheelRadius;
  // world (x, y, depth z) -> screen; depth goes up-left, exposing approaching walls
  const DX = -0.5, DY = 0.25;
  const P = (x, y, z = 0) => [w / 2 + (x - camX + z * DX) * scale, baseY - (y - camY + z * DY) * scale];

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9fd3f0'); sky.addColorStop(1, '#e8f4fb');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

  // terrain: the track polyline (level beyond its ends) as a strip from z=-1 (front) to z=+3 (back),
  // drawn right to left so nearer (left-hand) faces paint over farther ones
  const x0 = camX - w / scale, x1 = camX + w / scale;
  const Z0 = -1, Z1 = 3;
  const t = p.track, first = t[0], last = t[t.length - 1];
  const pts = [[Math.min(x0, first[0]), first[1]], ...t, [Math.max(x1, last[0]), last[1]]];
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  for (let i = pts.length - 1; i >= 1; i--) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if (bx < x0 || ax > x1) continue;
    poly(ctx, [P(ax, ay, Z0), P(bx, by, Z0), P(bx, by, Z1), P(ax, ay, Z1)], ax === bx ? '#7a5636' : '#8bc34a');
    poly(ctx, [P(ax, ay, Z0), P(bx, by, Z0), P(bx, by - 0.4, Z0), P(ax, ay - 0.4, Z0)], '#6d4c2f');
    const [fax, fay] = P(ax, ay - 0.4, Z0), [fbx, fby] = P(bx, by - 0.4, Z0);
    poly(ctx, [[fax, fay], [fbx, fby], [fbx, h], [fax, h]], '#5a3d25');
    // tiles and distance markers
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
    for (let z = Z0; z <= Z1; z++) line(ctx, P(ax, ay, z), P(bx, by, z));
    ctx.fillStyle = '#33691e';
    for (let gx = Math.ceil(Math.max(ax, x0)); gx < Math.min(bx, x1); gx++) {
      const gy = ay + ((by - ay) * (gx - ax)) / (bx - ax);
      line(ctx, P(gx, gy, Z0), P(gx, gy, Z1));
      if (gx % 5 === 0) { const [mx, my] = P(gx, gy, Z0); ctx.fillText(gx + ' m', mx, my + 16); }
    }
  }

  // finish: a chequered line across the strip and a flag behind the rider's plane
  if (p.finish > x0 && p.finish < x1) {
    const fx = p.finish, fy = groundY(t, fx), c = 0.2; // chequer size, m
    for (let z = Z0, k = 0; z < Z1; z += c, k++) {
      for (let j = 0; j < 2; j++) poly(ctx, [P(fx + (j - 1) * c, fy, z), P(fx + j * c, fy, z), P(fx + j * c, fy, z + c), P(fx + (j - 1) * c, fy, z + c)], (j + k) % 2 ? '#fff' : '#222');
    }
    const zf = Z1 - 0.5, top = fy + 1.6; // the flag on a pole at the back of the strip
    ctx.strokeStyle = '#555'; ctx.lineWidth = 3; line(ctx, P(fx, fy, zf), P(fx, top, zf)); ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const ax = fx + i * 0.15, ay = top - j * 0.12;
      poly(ctx, [P(ax, ay, zf), P(ax + 0.15, ay, zf), P(ax + 0.15, ay - 0.12, zf), P(ax, ay - 0.12, zf)], (i + j) % 2 ? '#fff' : '#222');
    }
  }

  // shadow (rider moves in z=0 plane)
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  const shadowX = s.x + Math.sin(s.theta) * 0.4;
  const [sx, sy] = P(shadowX, groundY(t, shadowX), 0);
  ctx.beginPath(); ctx.ellipse(sx, sy, scale * 0.45, scale * 0.1, 0, 0, 7); ctx.fill();

  drawRider(ctx, s, p, P, scale);

  // HUD
  ctx.fillStyle = '#123'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
  const best = ui.level && ui.bestTimes[ui.level.name];
  if (ui.level) ctx.fillText(`${ui.level.name}   Time: ${s.t.toFixed(2)} s   Best: ${best ? best.toFixed(2) + ' s' : '—'}   To the finish: ${Math.max(0, p.finish - s.x).toFixed(0)} m`, 12, 22);
  ctx.fillText('← → / A D — pedal,  ↑ / W / Space — jump (hold to charge),  L — download physics log (CSV)', 12, 42);
  ctx.font = '12px monospace'; ctx.fillStyle = '#345';
  ctx.fillText(`v=${s.v.toFixed(2)} m/s  a=${s.acc.toFixed(2)}  θ=${(s.theta * 180 / Math.PI).toFixed(1)}°  hip=${((s.torsoTheta - s.theta) * 180 / Math.PI).toFixed(1)}°  ω=${s.omega.toFixed(2)}  α=${s.alpha.toFixed(2)}  τ=${s.tau.toFixed(0)} N·m`, 12, 62);
  // jump charge: fills while jump is held, lit orange during the push-off
  ctx.fillText('jump', 12, 82);
  ctx.strokeStyle = '#345'; ctx.lineWidth = 1; ctx.strokeRect(50.5, 72.5, 120, 12);
  ctx.fillStyle = s.push > 0 ? '#ef6c00' : '#1565c0'; ctx.fillRect(52, 74, 117 * s.charge, 9);
  if (ui.menu) {
    ctx.fillStyle = 'rgba(10,20,30,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif'; ctx.fillText('UNICYCLE DEFEAT', w / 2, h * 0.2);
    if (ui.result) {
      const { name, time, record } = ui.result;
      ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = record ? '#ffd54f' : '#fff';
      ctx.fillText(`${name}: finished in ${time.toFixed(2)} s${record ? ' — new best!' : ''}`, w / 2, h * 0.28);
      ctx.fillStyle = '#fff';
    }
    if (!ui.levels) {
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(ui.levelError ? 'Levels failed to load — run node dev-server.js' : 'Loading levels…', w / 2, menuRowY(h, 0));
    }
    ui.levels?.forEach((level, i) => {
      const y = menuRowY(h, i), on = i === ui.levelIndex, best = ui.bestTimes[level.name];
      if (on) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(w / 2 - 220, y - MENU_ROW / 2, 440, MENU_ROW); ctx.fillStyle = '#fff'; }
      ctx.font = `${on ? 'bold ' : ''}22px sans-serif`;
      ctx.fillText(`${on ? '▶ ' : ''}${i + 1}. ${level.name}   best: ${best ? `${best.toFixed(2)} s` : '—'}`, w / 2, y + 8);
    });
    const y = menuRowY(h, ui.levels?.length ?? 1) + 16;
    ctx.font = '14px sans-serif'; ctx.fillText('↑ / ↓ — pick a level,  Enter / Space / click — start,  Esc in game — back to menu', w / 2, y);
  }
}

function drawRider(ctx, s, p, P, scale) {
  const R = p.wheelRadius;
  const sn = Math.sin(s.theta), cs = Math.cos(s.theta);
  const axX = s.x, axY = s.y;
  const S = ([x, y]) => P(x, y);
  const wheelAngle = s.wheelAngle; // the wheel's own spin (rolling on the ground, free in the air); + is clockwise on screen
  const axle = [axX, axY];
  const crank = p.crankLength;
  const pedal = (phase) => [axX + crank * Math.cos(wheelAngle + phase), axY - crank * Math.sin(wheelAngle + phase)];
  const pedalR = pedal(0), pedalL = pedal(Math.PI);
  // All rider landmarks use the same articulated geometry as terrain contact.
  const body = (d, side = 0) => {
    const point = bodyPoint(s, d, p);
    return [point.x + side * cs, point.y - side * sn];
  };
  const hip = body(HIP), shoulder = body(SHOULDER), head = body(HEAD);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // far leg (behind wheel)
  drawLeg(ctx, S, hip, pedalL, '#37474f', scale);

  // wheel
  const [ax, ay] = S(axle);
  ctx.strokeStyle = '#222'; ctx.lineWidth = scale * 0.05;
  ctx.beginPath(); ctx.arc(ax, ay, R * scale - ctx.lineWidth / 2, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = wheelAngle + (i * Math.PI) / 6;
    line(ctx, [ax, ay], [ax + Math.cos(a) * R * scale * 0.9, ay + Math.sin(a) * R * scale * 0.9]);
  }
  // frame + seat
  ctx.strokeStyle = '#c62828'; ctx.lineWidth = scale * 0.035;
  line(ctx, S(axle), S(body(SEAT - 0.05)));
  ctx.strokeStyle = '#111'; ctx.lineWidth = scale * 0.05;
  line(ctx, S(body(SEAT, -0.1)), S(body(SEAT, 0.1)));
  // cranks
  ctx.strokeStyle = '#555'; ctx.lineWidth = scale * 0.025;
  line(ctx, S(pedalL), S(pedalR));
  ctx.fillStyle = '#333';
  for (const pd of [pedalL, pedalR]) { const [x, y] = S(pd); ctx.fillRect(x - scale * 0.04, y - scale * 0.012, scale * 0.08, scale * 0.024); }

  // torso
  ctx.strokeStyle = '#1565c0'; ctx.lineWidth = scale * 0.11;
  line(ctx, S(hip), S(shoulder));
  // arms: fixed pose relative to the torso, shared with collision geometry
  for (const [side, col] of [[-1, '#1e88e5'], [1, '#1976d2']]) {
    const { elbow, hand } = armPoints(s, { x: shoulder[0], y: shoulder[1] }, side);
    ctx.strokeStyle = col; ctx.lineWidth = scale * 0.05;
    ctx.beginPath(); ctx.moveTo(...S(shoulder)); ctx.lineTo(...P(elbow.x, elbow.y)); ctx.lineTo(...P(hand.x, hand.y)); ctx.stroke();
  }
  // head
  const [hx, hy] = S(head);
  ctx.fillStyle = '#f1c27d'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(hx, hy, HEAD_R * scale, 0, 7); ctx.fill(); ctx.stroke();

  // near leg (in front of wheel)
  drawLeg(ctx, S, hip, pedalR, '#263238', scale);
}

function drawLeg(ctx, S, hip, foot, color, scale) {
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 1e-3);
  // knee forward (+x direction of travel): two-bone IK
  const a = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
  const base = Math.atan2(dy, dx);
  const ka = base + a;
  const knee = [hip[0] + Math.cos(ka) * THIGH, hip[1] + Math.sin(ka) * THIGH];
  ctx.strokeStyle = color; ctx.lineWidth = scale * 0.07;
  ctx.beginPath(); ctx.moveTo(...S(hip)); ctx.lineTo(...S(knee)); ctx.lineTo(...S(foot)); ctx.stroke();
}

function line(ctx, [x1, y1], [x2, y2]) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function poly(ctx, pts, fill) {
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
