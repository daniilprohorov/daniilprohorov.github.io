import { featureY, featureBeta, supportFeature, inDomain, cutsTrack, nearestOnTrack, trackPoint, crosses, distToSegment } from './terrain.js';
import { SEAT, HIP, SHOULDER, HEAD, HEAD_R, bodyPoint, armPoints } from './rider-geometry.js';

// A rolling wheel, telescoping lower link and hinged torso, planar. Both absolute angles are
// measured clockwise from vertical. Pedals and the hip spring exchange equal/opposite torques;
// neither joint targets world upright. Contact solves wheel, both angles and leg acceleration
// together. Flight eliminates translation, moves the COM ballistically, and conserves total spin.

const G = 9.81;

export const DEFAULT_PARAMS = {
  wheelRadius: 0.3,    // m (24" wheel)
  wheelMass: 3,        // kg
  bodyMass: 70,        // kg, rider + frame
  bodyCom: 0.9,        // m, center of mass above axle with the legs at their riding length
  legStiffness: 15000, // N/m, legs: a spring between wheel and body along the body axis; at bodyCom it carries the body's weight
  legDamping: 1200,    // N·s/m, the legs' damping (≈ 0.6 of critical for the body on them)
  legMin: 0.7,         // m, center of mass above axle with the legs fully bent: a hard stop
  jumpChargeTime: 0.5, // s, holding jump longer than this charges no further
  crouchDepth: 0.15,   // m, how far the legs' setpoint drops at full charge (the rider crouches)
  jumpReach: 0.285,    // m, how far above bodyCom the legs' setpoint goes during the push-off at full charge (≈ 0.45 m hop)
  jumpPushTime: 0.15,  // s, how long the push-off lasts
  bodyInertia: 8,      // kg·m², about own COM
  torsoMassFraction: 0.55, // upper-link share of bodyMass; the rest is the lower link
  torsoCom: 0.25,      // m, upper-link COM above the hip
  torsoInertia: 2.4,   // kg·m², upper-link inertia about its own COM
  hipStiffness: 1500,  // N·m/rad, spring opposing torsoTheta - theta at rest: the torso nearly follows the pelvis
  hipDamping: 80,      // N·m·s/rad, internal damping opposing torsoOmega - omega at rest
  hipStiffnessFast: 140, // N·m/rad, the same spring from hipSoftSpeed up; must exceed the torso's gravity stiffness (≈ 94) or it flops
  hipDampingFast: 24,  // N·m·s/rad, the same damping from hipSoftSpeed up
  hipSoftSpeed: 4,     // m/s, horizontal speed at which the hip reaches its fast, soft setting
  hipDriveSlow: 30,    // N·m, hip torque per pedal input near rest: → pitches the torso forward (+)
  hipDriveFast: -30,   // N·m, the same from hipSoftSpeed up: → throws the torso back (−)
  hipManualAngle: 0.26, // rad (≈ 15°), hip spring setpoint (torsoTheta − theta) per manual torso input (`hip` in step): + forward
  maxHipTorque: 90,    // N·m, spring/damper torque limit (equal and opposite on both links)
  pedalAccel: 5,       // m/s² target axle acceleration from held pedals
  pedalAccelMax: 8,    // m/s² target when pushing toward a lean of leanForMaxBoost or more
  leanTorqueBoost: 40, // N·m, extra leg torque (not cadence-faded) toward a lean of leanForMaxBoost: body weight on the pedal
  leanForMaxBoost: 0.35, // rad (≈ 20°), lean at which the boosts above reach full strength
  releaseDecel: 0.5,   // m/s², slower coast-down to zero after release
  accelRiseTime: 0.1,  // s, time for acceleration to go 0 → pedalAccel (and back)
  maxCadence: 200,     // rpm, cadence at which the legs can no longer push the wheel forward
  maxPedalTorque: 100, // N·m, leg torque at the cranks from standstill (≈ 800 N on a 0.125 m crank)
  rollingResistance: 0.015, // rolling resistance coefficient (tyre on asphalt)
  dragArea: 0.5,       // m², Cd·A of an upright rider
  airDensity: 1.2,     // kg/m³
  dragHeight: 0.9,     // m, centre of air pressure above the axle
  timeScale: 0.65,     // game time slowdown for playability
  crankLength: 0.125,  // m
  track: [[-1e6, 0], [1e6, 0]], // terrain polyline of [x, y] points, m, ordered by x; flat floor by default
  finish: Infinity,    // m, the finish line's x: the run is over (`finished`) once the axle crosses it
  levelUrls: ['learning', 'ledges', 'pits'].map((n) => new URL(`../levels/${n}.json`, import.meta.url).href), // level JSONs { name, points, start, finish } listed in the menu; fetched, so they need the dev server
  consoleLog: true,    // log input changes and falls to the console
  logEndpoint: null,   // URL to POST log rows to every second (see dev-server.js); null = off
};

/** Initial state: at rest with the wheel on the track `p.track` at `x` (a level's `start`). */
export function createState(x = 0, p = DEFAULT_PARAMS) {
  const y = featureY(supportFeature(p.track, x, p.wheelRadius), x);
  return {
    x, y, v: 0, vy: 0, theta: 0.03, omega: 0, torsoTheta: 0.03, torsoOmega: 0,
    wheelOmega: 0, wheelAngle: 0, acc: 0, accCmd: 0, alpha: 0, torsoAlpha: 0, tau: 0, hipTau: 0,
    leg: p.bodyCom, legV: 0, charge: 0, push: 0, t: 0, airborne: false, fallen: false, finished: false,
  };
}

/** 0..1: how far pushing in direction `dir` goes toward the lean (0 when pushing against it). */
function leanBoost(theta, dir, p) {
  return dir * theta > 0 ? Math.min(1, Math.abs(theta) / p.leanForMaxBoost) : 0;
}

/** Target wheel acceleration: held key accelerates, released coasts to zero.
 *  Pushing toward the lean ramps from pedalAccel up to pedalAccelMax with |theta|. */
function targetAccel(v, theta, input, p) {
  if (input !== 0) return input * (p.pedalAccel + (p.pedalAccelMax - p.pedalAccel) * leanBoost(theta, input, p));
  // coast; proportional near zero so the wheel stops smoothly
  return -Math.sign(v) * Math.min(p.releaseDecel, Math.abs(v) / p.accelRiseTime);
}

/** Ramp the acceleration command, including the free-rolling contribution of a slope. */
function commandedAccel(s, speed, input, dt, p, slopeAcc = 0) {
  const target = targetAccel(speed, s.theta, input, p) + slopeAcc;
  const maxDelta = Math.max(p.pedalAccel, Math.abs(target)) * dt / p.accelRiseTime;
  return s.accCmd + Math.max(-maxDelta, Math.min(maxDelta, target - s.accCmd));
}

function pedalTorque(s, speed, input, dt, p, torqueForAccel, slopeAcc = 0) {
  const maxSpeed = p.maxCadence * 2 * Math.PI * p.wheelRadius / 60;
  const fade = Math.max(0, 1 - Math.abs(speed) / maxSpeed);
  const hi = p.maxPedalTorque * (speed >= 0 ? fade : 1) + p.leanTorqueBoost * leanBoost(s.theta, 1, p);
  const lo = -p.maxPedalTorque * (speed <= 0 ? fade : 1) - p.leanTorqueBoost * leanBoost(s.theta, -1, p);
  const cmd = commandedAccel(s, speed, input, dt, p, slopeAcc);
  return { tau: Math.max(lo, Math.min(hi, torqueForAccel(cmd))), cmd };
}

/** Neutral links have combined COM at leg and own-COM rigid inertia bodyInertia, whenever the
 *  requested torso inertia and COM separation leave a positive lower-link inertia. */
function links(s, p) {
  const mt = p.bodyMass * p.torsoMassFraction, ml = p.bodyMass - mt;
  const offset = HIP - p.bodyCom, c = p.torsoCom, h = s.leg + offset;
  const a = s.leg - mt * (offset + c) / ml;
  const Il = Math.max(0.05, p.bodyInertia - p.torsoInertia - p.bodyMass * p.torsoMassFraction * (offset + c) ** 2 / (1 - p.torsoMassFraction));
  const A = ml * a + mt * h, B = mt * c, C = mt * h * c;
  const sn = Math.sin(s.theta), cs = Math.cos(s.theta), st = Math.sin(s.torsoTheta), ct = Math.cos(s.torsoTheta);
  const sd = Math.sin(s.torsoTheta - s.theta), cd = Math.cos(s.torsoTheta - s.theta);
  return { M: p.wheelMass + p.bodyMass, A, B, C, D: Il + ml * a * a + mt * h * h,
    E: p.torsoInertia + mt * c * c, F: -B * sd, sn, cs, st, ct, sd, cd };
}

// Contact coordinates: path distance, lower angle, torso angle, leg length.
function contactMetric(m, beta, p) {
  const c = Math.cos(beta), b = Math.sin(beta);
  const u = m.A * (m.cs * c - m.sn * b), w = m.B * (m.ct * c - m.st * b);
  const r = p.bodyMass * (m.sn * c + m.cs * b), C = m.C * m.cd;
  return [[m.M + p.wheelMass, u, w, r], [u, m.D, C, 0], [w, C, m.E, m.F], [r, 0, m.F, p.bodyMass]];
}

// Translation eliminated at fixed COM. Wheel spin remains an independent coordinate.
function flightMetric(m, p) {
  const C = (m.C - m.A * m.B / m.M) * m.cd;
  return [[m.D - m.A * m.A / m.M, C, 0],
    [C, m.E - m.B * m.B / m.M, m.F * p.wheelMass / m.M],
    [0, m.F * p.wheelMass / m.M, p.bodyMass * p.wheelMass / m.M]];
}

/** Small positive-definite mass systems, including constrained principal submatrices. */
function solve(matrix, rhs, n = rhs.length) {
  const a = matrix.slice(0, n).map((row) => row.slice(0, n)), x = rhs.slice(0, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const f = a[j][i] / a[i][i];
      for (let k = i + 1; k < n; k++) a[j][k] -= f * a[i][k];
      x[j] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= a[i][j] * x[j];
    x[i] /= a[i][i];
  }
  return x;
}

/** Hip spring, damper and the rider's hip drive at horizontal speed `speed` with pedal `input`:
 *  stiff near rest, soft from hipSoftSpeed up, blended with a smoothstep. The drive follows the
 *  player's key only (no lean feedback): near rest → bends the torso forward, at speed back.
 *  In manual mode (`hip` ∈ {-1, 0, 1}, not null) the hip keeps its rest stiffness at any speed and the
 *  pedals don't drive it: instead the spring's setpoint moves to `hip · hipManualAngle`.
 *  Internal only: both links get equal and opposite torques. */
export function hipGains(speed, p, input = 0, hip = null) {
  const x = hip === null ? Math.min(1, Math.abs(speed) / p.hipSoftSpeed) : 0, w = x * x * (3 - 2 * x);
  return { k: p.hipStiffness + (p.hipStiffnessFast - p.hipStiffness) * w,
    c: p.hipDamping + (p.hipDampingFast - p.hipDamping) * w,
    drive: hip === null ? input * (p.hipDriveSlow + (p.hipDriveFast - p.hipDriveSlow) * w) : 0,
    target: hip === null ? 0 : hip * p.hipManualAngle };
}

/** Backward spring/damper forces are part of the SAME mass solve, not a torso response after
 *  integrating the pelvis. A saturated hip torque is re-solved as a bounded internal force. */
function jointAccelerations(metric, force, s, dt, p, lowerIndex, speed, input, hip, locked = false) {
  const upperIndex = lowerIndex + 1, legIndex = upperIndex + 1;
  const { k, c, drive, target } = hipGains(speed, p, input, hip);
  const hipDrag = c + k * dt;
  const hip0 = drive - k * (s.torsoTheta - s.theta - target) - hipDrag * (s.torsoOmega - s.omega);
  const legImplicit = (p.legDamping + p.legStiffness * dt) * dt;
  const compute = (fixedHip) => {
    const a = metric.map((row) => row.slice()), q = force.slice();
    a[legIndex][legIndex] += legImplicit;
    const hip = fixedHip ?? hip0;
    q[lowerIndex] -= hip; q[upperIndex] += hip;
    if (fixedHip === null) {
      const h = hipDrag * dt;
      a[lowerIndex][lowerIndex] += h; a[upperIndex][upperIndex] += h;
      a[lowerIndex][upperIndex] -= h; a[upperIndex][lowerIndex] -= h;
    }
    const acc = solve(a, q, locked ? legIndex : q.length);
    if (locked) acc.push(0);
    return acc;
  };
  let acc = compute(null);
  let hipTau = hip0 - hipDrag * dt * (acc[upperIndex] - acc[lowerIndex]);
  if (Math.abs(hipTau) > p.maxHipTorque) {
    hipTau = Math.sign(hipTau) * p.maxHipTorque;
    acc = compute(hipTau);
  }
  if (!locked && s.leg <= p.legMin && s.legV <= 0 && acc[legIndex] < 0) {
    return jointAccelerations(metric, force, s, dt, p, lowerIndex, speed, input, hip, true);
  }
  return { acc, hipTau };
}

/** Inverse contact dynamics at a commanded axle acceleration. Eliminating pedal torque leaves
 *  one simultaneous solve for both angular accelerations and the legs, including joint limits. */
function contactTorque(metric, force, s, acceleration, dt, p, input, hip) {
  const R = p.wheelRadius;
  const shape = metric.slice(1).map((row, i) => row.slice(1).map((value, j) =>
    value + (i === 0 ? R * metric[0][j + 1] : 0)));
  const rhs = force.slice(1).map((value, i) => value - metric[i + 1][0] * acceleration
    - (i === 0 ? R * (metric[0][0] * acceleration - force[0]) : 0));
  const { acc } = jointAccelerations(shape, rhs, s, dt, p, 0, s.v, input, hip);
  return R * (metric[0][0] * acceleration - force[0]
    + metric[0][1] * acc[0] + metric[0][2] * acc[1] + metric[0][3] * acc[2]);
}

function comOffset(s, m, p) {
  return {
    x: (m.A * m.sn + m.B * m.st) / m.M,
    y: (m.A * m.cs + m.B * m.ct) / m.M,
    vx: (p.bodyMass * s.legV * m.sn + m.A * s.omega * m.cs + m.B * s.torsoOmega * m.ct) / m.M,
    vy: (p.bodyMass * s.legV * m.cs - m.A * s.omega * m.sn - m.B * s.torsoOmega * m.st) / m.M,
  };
}

function shapeMomentum(s, metric) {
  return (metric[0][0] + metric[1][0]) * s.omega
    + (metric[0][1] + metric[1][1]) * s.torsoOmega
    + (metric[0][2] + metric[1][2]) * s.legV;
}

function fly(s, vx, vy, spin, input, hip, dt, lSet, p) {
  const m = links(s, p), metric = flightMetric(m, p), old = comOffset(s, m, p);
  const Iw = p.wheelMass * p.wheelRadius ** 2;
  const { tau, cmd } = pedalTorque(s, p.wheelRadius * spin, input, dt, p, (acc) => Iw * acc / p.wheelRadius);
  const rho = p.wheelMass / m.M, U = m.C - m.A * m.B / m.M;
  const force = [
    -tau - 2 * rho * m.A * s.legV * s.omega + U * s.torsoOmega ** 2 * m.sd,
    -2 * rho * m.B * s.legV * s.omega * m.cd - U * s.omega ** 2 * m.sd,
    p.bodyMass * G + p.legStiffness * (lSet - s.leg)
      - (p.legDamping + p.legStiffness * dt) * s.legV
      + rho * (m.A * s.omega ** 2 + m.B * s.torsoOmega ** 2 * m.cd),
  ];
  // the joint's speed is the centre of mass's horizontal speed, constant in flight
  const { acc, hipTau } = jointAccelerations(metric, force, s, dt, p, 0, vx + old.vx, input, hip);
  const next = { ...s, airborne: true, omega: s.omega + acc[0] * dt, torsoOmega: s.torsoOmega + acc[1] * dt,
    legV: s.legV + acc[2] * dt, wheelOmega: spin + tau * dt / Iw, tau, hipTau, acc: tau * p.wheelRadius / Iw, accCmd: cmd };
  next.theta += (s.omega + next.omega) * dt / 2;
  next.torsoTheta += (s.torsoOmega + next.torsoOmega) * dt / 2;
  next.leg = Math.max(p.legMin, s.leg + next.legV * dt);
  const mn = links(next, p), metricNew = flightMetric(mn, p);
  // Correct only roundoff/integration drift in the conserved common-rotation momentum. This
  // changes neither relative angular velocity nor either angle; it is not an upright controller.
  const targetL = shapeMomentum(s, metric) - tau * dt;
  const correction = (targetL - shapeMomentum(next, metricNew))
    / (metricNew[0][0] + 2 * metricNew[0][1] + metricNew[1][1]);
  next.omega += correction; next.torsoOmega += correction;
  if (next.leg <= p.legMin && next.legV < 0) bottomOut(next, p);
  const offset = comOffset(next, mn, p), vcx = vx + old.vx, vcy = vy + old.vy;
  next.x = s.x + old.x + vcx * dt - offset.x;
  next.y = s.y + old.y + vcy * dt - G * dt * dt / 2 - offset.y;
  next.v = vcx - offset.vx; next.vy = vcy - G * dt - offset.vy;
  next.alpha = (next.omega - s.omega) / dt; next.torsoAlpha = (next.torsoOmega - s.torsoOmega) / dt;
  return next;
}

/** Advance jointly coupled contact/flight physics. Only the input, jump and (manual mode) hip
 *  setpoints are active controls; joint springs/dampers act internally and the ground can push but
 *  never pull. `hip` null: the pedal input also drives the hip; −1/0/1: manual torso drive. */
export function step(s, input, jump, dt, p = DEFAULT_PARAMS, hip = null) {
  const R = p.wheelRadius;
  let lSet = p.bodyCom;
  if (s.push <= 0 && jump) {
    s.charge = Math.min(1, s.charge + dt / p.jumpChargeTime);
    lSet -= p.crouchDepth * s.charge * (2 - s.charge);
  } else if (s.charge > 0) {
    if (s.push <= 0) s.push = p.jumpPushTime;
    lSet += p.jumpReach * Math.sqrt(s.charge);
    s.push -= dt;
    if (s.push <= 0) { s.push = 0; s.charge = 0; }
  }
  if (!s.airborne) {
    const m = links(s, p), f = supportFeature(p.track, s.x, R);
    const beta = featureBeta(f, s.x), sb = Math.sin(beta), cb = Math.cos(beta), curvature = f.line ? 0 : -1 / R;
    const st = Math.sin(s.theta + beta), ct = Math.cos(s.theta + beta);
    const su = Math.sin(s.torsoTheta + beta), cu = Math.cos(s.torsoTheta + beta);
    const centripetal = curvature * s.v * s.v;
    const roll = -p.rollingResistance * m.M * G * cb * Math.tanh(s.v / 0.1);
    const air = -0.5 * p.airDensity * p.dragArea * s.v * Math.abs(s.v);
    const metric = contactMetric(m, beta, p);
    const force = [
      -m.M * G * sb + roll + air - 2 * p.bodyMass * s.legV * s.omega * ct
        + m.A * s.omega ** 2 * st + m.B * s.torsoOmega ** 2 * su,
      G * m.A * m.sn + air * p.dragHeight * ct - 2 * m.A * s.legV * s.omega
        + m.C * s.torsoOmega ** 2 * m.sd + centripetal * m.A * st,
      G * m.B * m.st - 2 * m.B * s.legV * s.omega * m.cd
        - m.C * s.omega ** 2 * m.sd + centripetal * m.B * su,
      p.bodyMass * G + p.legStiffness * (lSet - s.leg)
        - (p.legDamping + p.legStiffness * dt) * s.legV - p.bodyMass * G * m.cs
        + m.A * s.omega ** 2 + m.B * s.torsoOmega ** 2 * m.cd - p.bodyMass * centripetal * ct,
    ];
    // Preserve the original acceleration control; solve its required pedal torque, then clamp it.
    // Both links remain dynamic: no angle, angular velocity or hip target is prescribed.
    const slopeAcc = -m.M * G * sb / (m.M + p.wheelMass);
    const { tau, cmd } = pedalTorque(s, s.v, input, dt, p,
      (a) => contactTorque(metric, force, s, a, dt, p, input, hip), slopeAcc);
    force[0] += tau / R; force[1] -= tau;
    const { acc, hipTau } = jointAccelerations(metric, force, s, dt, p, 1, s.v, input, hip);
    const [a, alpha, torsoAlpha, ldd] = acc;
    const normal = m.M * (G * cb + centripetal) + p.bodyMass * ldd * ct
      - (2 * p.bodyMass * s.legV * s.omega + m.A * alpha) * st
      - m.B * torsoAlpha * su - m.A * s.omega ** 2 * ct - m.B * s.torsoOmega ** 2 * cu;
    const free = normal < 0 ? fly(s, s.v * cb, s.v * sb, s.v / R, input, hip, dt, lSet, p) : null;
    if (free && !cutsTrack(p.track, free.x, free.y, R)) {
      Object.assign(s, free);
    } else {
      s.v += a * dt; s.omega += alpha * dt; s.torsoOmega += torsoAlpha * dt; s.legV += ldd * dt;
      s.theta += s.omega * dt; s.torsoTheta += s.torsoOmega * dt;
      s.leg = Math.max(p.legMin, s.leg + s.legV * dt);
      if (s.leg <= p.legMin && s.legV < 0) bottomOut(s, p);
      rollAlong(s, s.v * cb * dt, f, p);
      s.wheelOmega = s.v / R;
      s.acc = a; s.accCmd = cmd; s.alpha = alpha; s.torsoAlpha = torsoAlpha; s.tau = tau; s.hipTau = hipTau;
    }
  } else {
    const x0 = s.x, y0 = s.y;
    Object.assign(s, fly(s, s.v, s.vy, s.wheelOmega, input, hip, dt, lSet, p));
    touchDown(s, x0, y0, p);
  }
  if (s.leg <= p.legMin && s.legV < 0) bottomOut(s, p);
  s.wheelAngle += s.wheelOmega * dt;
  s.t += dt;
  s.fallen = touchesGround(s, p);
  if (!s.fallen && s.x >= p.finish) s.finished = true;
  return s;
}

/** Move the wheel along the axle path by dx in x from feature f. Where the path turns up into a
 *  new part (a valley corner, or an edge lower than R), the wheel hits it at the corner and rolls on
 *  along it; where the new part rises straight up (an edge at or above the axle), the wheel stops.
 *  Keeps the axle's vertical velocity `vy` in step. */
function rollAlong(s, dx, f, p) {
  const R = p.wheelRadius, x = s.x + dx;
  const next = supportFeature(p.track, x, R);
  if (next !== f && inDomain(f, x) && featureY(next, x) > featureY(f, x)) {
    const gap = (xi) => featureY(next, xi) - featureY(f, xi);
    const entry = dx > 0 ? next.x0 : next.x1; // where the new part begins, in the direction of travel
    let a = s.x, b = x;
    if (dx > 0 ? s.x <= entry : entry <= s.x) {
      if (gap(entry) > 1e-9) {
        const beta = featureBeta(f, entry);
        stopAgainst(s, s.v * Math.cos(beta), s.v * Math.sin(beta), p);
        s.x = entry; s.y = featureY(f, entry); s.vy = 0;
        return;
      }
      a = entry;
    }
    // the corner: gap(a) ≤ 0 < gap(b)
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (gap(m) > 0) b = m; else a = m;
    }
    const beta = featureBeta(f, b);
    rollOnto(s, featureBeta(next, b), s.v * Math.cos(beta), s.v * Math.sin(beta), s.v / R, p);
  }
  s.x = x; s.y = featureY(next, x); s.vy = s.v * Math.sin(featureBeta(next, x));
}

// Every plastic impact is a projection in the multibody kinetic mass metric. All momenta
// conjugate to allowed motion are conserved; the discarded velocity can only remove energy.
function internalMomenta(s, m, vx, vy, p) {
  return [
    m.A * (vx * m.cs - vy * m.sn) + m.D * s.omega + m.C * m.cd * s.torsoOmega,
    m.B * (vx * m.ct - vy * m.st) + m.C * m.cd * s.omega + m.E * s.torsoOmega + m.F * s.legV,
    p.bodyMass * (vx * m.sn + vy * m.cs + s.legV) + m.F * s.torsoOmega,
  ];
}

/** Plastic normal contact and no-slip rim: wheel path speed and all three shape velocities are
 *  solved jointly. Finite hip/leg forces do not transmit impulses across their free coordinates. */
function rollOnto(s, beta, vx, vy, spin, p, locked = false) {
  const m = links(s, p), metric = contactMetric(m, beta, p), cb = Math.cos(beta), sb = Math.sin(beta);
  const momentum = [
    m.M * (vx * cb + vy * sb) + p.wheelMass * p.wheelRadius * spin
      + metric[0][1] * s.omega + metric[0][2] * s.torsoOmega + metric[0][3] * s.legV,
    ...internalMomenta(s, m, vx, vy, p),
  ];
  const velocity = solve(metric, momentum, locked ? 3 : 4);
  [s.v, s.omega, s.torsoOmega] = velocity;
  s.legV = locked ? 0 : velocity[3];
  s.wheelOmega = s.v / p.wheelRadius;
}

/** A tall edge pins the axle and wheel spin, leaving both angles and the leg coordinate free. */
function stopAgainst(s, vx, vy, p) {
  const m = links(s, p), C = m.C * m.cd;
  const metric = [[m.D, C, 0], [C, m.E, m.F], [0, m.F, p.bodyMass]];
  [s.omega, s.torsoOmega, s.legV] = solve(metric, internalMomenta(s, m, vx, vy, p));
  s.v = 0; s.wheelOmega = 0;
}

/** The step reaches the hard-stop configuration before this mass-metric velocity projection.
 *  No angle is moved. In flight the COM velocity and angular momentum remain unchanged. */
function bottomOut(s, p) {
  if (s.airborne) {
    const m = links(s, p), metric = flightMetric(m, p), before = comOffset(s, m, p);
    const momentum = [
      metric[0][0] * s.omega + metric[0][1] * s.torsoOmega,
      metric[1][0] * s.omega + metric[1][1] * s.torsoOmega + metric[1][2] * s.legV,
    ];
    [s.omega, s.torsoOmega] = solve(metric, momentum);
    s.legV = 0;
    const after = comOffset(s, m, p);
    s.v += before.vx - after.vx; s.vy += before.vy - after.vy;
  } else {
    const R = p.wheelRadius, beta = featureBeta(supportFeature(p.track, s.x, R), s.x);
    rollOnto(s, beta, s.v * Math.cos(beta), s.v * Math.sin(beta), s.v / R, p, true);
    s.vy = s.v * Math.sin(beta);
  }
}

/** In flight the axle moved from (x0, y0) to (s.x, s.y). If the wheel now cuts into the track, it is
 *  put back where it first touched, and hits it: plastic along the contact normal, with friction along
 *  the tangent that brings the rim to the ground's speed (rollOnto along the tangent). Landing on the
 *  axle path, the wheel rolls on along it in contact mode. Against a wall face it flies on, sliding
 *  along the face for the rest of the step, and may land at its foot. */
function touchDown(s, x0, y0, p) {
  const R = p.wheelRadius;
  for (let hits = 0; hits < 3 && cutsTrack(p.track, s.x, s.y, R); hits++) {
    // where along the move it first touched: clear at a, cutting in at b
    const x1 = s.x, y1 = s.y;
    let a = 0, b = 1;
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (cutsTrack(p.track, x0 + m * (x1 - x0), y0 + m * (y1 - y0), R)) b = m; else a = m;
    }
    s.x = x0 + a * (x1 - x0); s.y = y0 + a * (y1 - y0);
    const f = supportFeature(p.track, s.x, R);
    if (Math.abs(featureY(f, s.x) - s.y) < 1e-6) {
      const beta = featureBeta(f, s.x);
      rollOnto(s, beta, s.v, s.vy, s.wheelOmega, p);
      s.y = featureY(f, s.x); s.vy = s.v * Math.sin(beta); s.wheelOmega = s.v / R;
      s.airborne = false;
      return;
    }
    const c = nearestOnTrack(p.track, s.x, s.y);
    const beta = Math.atan2(c.x - s.x, s.y - c.y); // along the face: the contact normal turned clockwise
    rollOnto(s, beta, s.v, s.vy, s.wheelOmega, p);
    s.wheelOmega = s.v / R; s.vy = s.v * Math.sin(beta); s.v *= Math.cos(beta);
    const slide = (x1 - s.x) * Math.cos(beta) + (y1 - s.y) * Math.sin(beta);
    x0 = s.x; y0 = s.y;
    s.x += slide * Math.cos(beta); s.y += slide * Math.sin(beta);
  }
  if (cutsTrack(p.track, s.x, s.y, R)) { s.x = x0; s.y = y0; }
}

/** A fall: the seat, torso, neck or either articulated arm crosses the track polyline
 *  (extended level beyond its ends), or the head circle touches it. */
function touchesGround(s, p) {
  const seat = bodyPoint(s, SEAT, p), sh = bodyPoint(s, SHOULDER, p), head = bodyPoint(s, HEAD, p);
  const sn = Math.sin(s.theta), cs = Math.cos(s.theta);
  const seatL = { x: seat.x - 0.1 * cs, y: seat.y + 0.1 * sn };
  const seatR = { x: seat.x + 0.1 * cs, y: seat.y - 0.1 * sn };
  const hip = bodyPoint(s, SEAT + 0.05, p);
  const arms = [-1, 1].map((side) => armPoints(s, sh, side));
  const minX = Math.min(seatL.x, seatR.x, hip.x, sh.x, head.x - HEAD_R,
    ...arms.flatMap(({ elbow, hand }) => [elbow.x, hand.x]));
  const maxX = Math.max(seatL.x, seatR.x, hip.x, sh.x, head.x + HEAD_R,
    ...arms.flatMap(({ elbow, hand }) => [elbow.x, hand.x]));
  for (let i = -1; i < p.track.length; i++) {
    const a = trackPoint(p.track, i), b = trackPoint(p.track, i + 1);
    if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX) continue;
    if (crosses(seatL, seatR, a, b) || crosses(hip, sh, a, b) || crosses(sh, head, a, b)
      || arms.some(({ elbow, hand }) => crosses(sh, elbow, a, b) || crosses(elbow, hand, a, b))
      || distToSegment(head, a, b) <= HEAD_R) return true;
  }
  return false;
}
