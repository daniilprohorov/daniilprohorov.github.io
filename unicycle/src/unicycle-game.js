// Unicycle Defeat — prototype. Embeddable: `new UnicycleGame(container).start()`.
//
// Physics: wheeled inverted pendulum (same model as a Segway), planar.
//   x, y  — wheel center (axle) position, m (+x right, +y up); the wheel rolls on the terrain
//   v     — wheel speed along the terrain (the path its axle follows), m/s; in flight the axle's
//           horizontal speed, with vy its vertical one
//   theta — body tilt from vertical around the axle, rad (+ leaning right)
// On a slope the wheel's acceleration acts along the slope and gravity pulls along it; edges are
// hit by the wheel circle (rolled over when low, a dead stop when higher than the axle). Where the
// ground would have to pull the wheel down (over a crest, off a ledge) it flies: the centre of mass
// is ballistic and the wheel spins on its own (wheelOmega), so the pedals only trade spin between
// wheel and body. Touching down, friction brings the rim to the ground's speed.
// The body rides on the legs, a spring-damper along its axis (leg = its centre of mass's distance
// from the axle) that absorbs landings and bottoms out at a hard stop, legMin. Holding jump bends
// them (a crouch that grows with the charge); releasing it pushes off, which can hop the wheel up.
// The player controls pedal (wheel) acceleration: holding a key accelerates at `pedalAccel`
// (the opposite key brakes at that rate); releasing coasts to zero at the slower `releaseDecel`.
// Acceleration itself ramps linearly toward the target over `accelRiseTime`, so presses don't jolt.
// The wheel's acceleration drives the body tilt: accelerating forward pitches
// the body back, so to catch a forward fall you pedal forward under the body.
// `tau` is the pedal torque the rider must apply for that motion against rolling resistance
// and air drag; its reaction pitches the body back, so holding speed needs a forward lean.

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
  pedalAccel: 5,       // m/s², speed change rate while a key is held (incl. braking with the opposite key)
  pedalAccelMax: 8,    // m/s², held-key accel when pushing toward a lean of leanForMaxBoost or more
  leanTorqueBoost: 40, // N·m, extra leg torque (not cadence-faded) toward a lean of leanForMaxBoost: body weight on the pedal
  leanForMaxBoost: 0.35, // rad (≈ 20°), lean at which the boosts above reach full strength
  releaseDecel: 0.5,   // m/s², slower coast-down to zero after release
  accelRiseTime: 0.1,  // s, time for acceleration to go 0 → pedalAccel (and back)
  maxCadence: 160,     // rpm, cadence at which the legs can no longer push the wheel forward
  maxPedalTorque: 100, // N·m, leg torque at the cranks from standstill (≈ 800 N on a 0.125 m crank)
  tiltDamping: 10,     // N·m·s/rad, rider stiffness (makes it playable)
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

// Body geometry: distances along the body axis from the axle with the legs at bodyCom, m; the body
// rides on the legs, so it sits `leg − bodyCom` further out.
const SEAT = 0.75, SHOULDER = 1.3, HEAD = 1.47, HEAD_R = 0.13;
const THIGH = 0.46, SHIN = 0.46, ARM = 0.6;

/** Initial state: at rest with the wheel on the track `p.track` at `x` (a level's `start`). */
export function createState(x = 0, p = DEFAULT_PARAMS) {
  const y = featureY(supportFeature(p.track, x, p.wheelRadius), x);
  return {
    x, y, v: 0, vy: 0, theta: 0.03, omega: 0, wheelOmega: 0, wheelAngle: 0, acc: 0, accCmd: 0, alpha: 0, tau: 0,
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

/** Acceleration moves toward the target linearly: full scale takes `accelRiseTime`. `v` is the
 *  rim's speed. On a slope the target also carries gravity's pull along it, `slopeAcc` (what a
 *  free-rolling wheel would get). It ramps from the last command `accCmd`, not from what the legs'
 *  torque limit let through: a load spike (a landing, an edge) does not become the rider's command. */
function commandedAccel(s, v, input, dt, p, slopeAcc) {
  const target = targetAccel(v, s.theta, input, p) + slopeAcc;
  const maxDelta = (Math.max(p.pedalAccel, Math.abs(target)) / p.accelRiseTime) * dt;
  return s.accCmd + Math.max(-maxDelta, Math.min(maxDelta, target - s.accCmd));
}

/** The rim's acceleration from the pedals this step, the rim moving at `speed`, and the command it
 *  came from: { acc, cmd }. `dynamics(acc)` gives the pedal torque `tau` an acceleration takes
 *  (linear in acc); `slopeAcc` is passed on to commandedAccel. */
function pedalAccel(s, speed, input, dt, p, slopeAcc, dynamics) {
  // legs: full torque at rest, falling linearly to zero at maxCadence when pushing along the motion;
  // resisting the motion (braking) always gets full torque. Pushing toward the lean adds body weight
  // on the pedal: up to leanTorqueBoost, not faded by cadence.
  const maxSpeed = (p.maxCadence / 60) * 2 * Math.PI * p.wheelRadius;
  const fade = Math.max(0, 1 - Math.abs(speed) / maxSpeed);
  const hi = p.maxPedalTorque * (speed >= 0 ? fade : 1) + p.leanTorqueBoost * leanBoost(s.theta, 1, p);
  const lo = -p.maxPedalTorque * (speed <= 0 ? fade : 1) - p.leanTorqueBoost * leanBoost(s.theta, -1, p);
  // tau is linear in acc: map the command to a torque within what the legs can deliver, then solve for acc
  const tau0 = dynamics(0).tau, dTau = dynamics(1).tau - tau0;
  const cmd = commandedAccel(s, speed, input, dt, p, slopeAcc);
  const tau = tau0 + dTau * cmd;
  return { acc: tau > hi ? (hi - tau0) / dTau : tau < lo ? (lo - tau0) / dTau : cmd, cmd };
}

/** Advance physics by dt seconds with the pedals' input in {-1, 0, 1} and `jump` held (true) or not.
 *  Mutates `s`.
 *  Contact mode: the wheel rolls on the track; `v` is its speed along the path its axle follows,
 *  whose tangent makes angle `beta` with +x. Where the ground would have to pull the wheel to keep
 *  it on (normal reaction N < 0: over a crest, off a ledge), the wheel takes off.
 *  Flight mode (`airborne`): `(v, vy)` is the axle's velocity and the wheel spins on its own at
 *  `wheelOmega`, until the wheel touches the track again (touchDown).
 *  In both modes the body slides along its axis on the legs: `leg` is its centre of mass's distance
 *  from the axle, `legV` its rate. Holding jump bends them (`charge` grows 0 → 1 over
 *  jumpChargeTime); releasing it pushes off (for `push` s more). */
export function step(s, input, jump, dt, p = DEFAULT_PARAMS) {
  const R = p.wheelRadius, mw = p.wheelMass, mb = p.bodyMass, l = s.leg;
  const Iw = mw * R * R; // mass sits in the rim/tyre: thin hoop
  const sin = Math.sin(s.theta), cos = Math.cos(s.theta);
  // legs: a spring-damper between wheel and body along the body axis. It pushes the body out with
  // F = mb·G + legStiffness·(lSet − leg) − legDamping·legV, so at the setpoint lSet (bodyCom, the
  // riding length) it carries the body's weight; below legMin the legs are at their stop (bottomOut).
  // `legAccel(m, rest)` is leg'' for the legs moving mass m under F plus other accelerations `rest`
  // along the axis. Spring and damper act with the step's end values (implicit Euler: `legDrag` is
  // F's loss per unit of the end legV), so stiff legs on the light wheel stay stable.
  // Jump: while it is held the rider crouches, the setpoint dropping by crouchDepth·charge·(2 − charge)
  // (easing out, so the body has settled by full charge and holding on adds nothing); on release the
  // legs push off for jumpPushTime, the setpoint raised by jumpReach·√charge, so the spring's energy,
  // and so the hop's height, grow roughly in proportion to the charge. Past the setpoint the spring
  // pulls, so the body flying up lifts the wheel.
  let lSet = p.bodyCom;
  if (s.push <= 0 && jump) {
    s.charge = Math.min(1, s.charge + dt / p.jumpChargeTime);
    lSet -= p.crouchDepth * s.charge * (2 - s.charge);
  } else if (s.charge > 0) {
    if (s.push <= 0) s.push = p.jumpPushTime; // released: push off
    lSet += p.jumpReach * Math.sqrt(s.charge);
    s.push -= dt;
    if (s.push <= 0) { s.push = 0; s.charge = 0; }
  }
  const legDrag = p.legStiffness * dt + p.legDamping;
  const legAccel = (m, rest) => ((mb * G + p.legStiffness * (lSet - l) - legDrag * s.legV) / m + rest) / (1 + (legDrag * dt) / m);
  // flight: wheel and body turn about their common centre of mass, k up the body axis from the axle;
  // J = Ib + mu·leg² (mu the reduced mass of wheel and body) is the body's moment of inertia about it.
  // The centre of mass flies ballistically. The pedals spin the wheel (Iw·wheelOmega' = tau) and turn
  // the body the other way ((J·omega)' = −tau); the legs only push wheel and body apart
  // (mu·(leg'' − leg·omega²) = F). Gravity has no moment about the centre of mass and nothing else
  // acts from outside (no tilt damping, no air drag), so J·omega + Iw·wheelOmega is conserved.
  // `fly` steps it from the axle velocity (vx, vy) and wheel spin, exact for constant accelerations,
  // and returns the new state fields.
  const M = mw + mb, mu = (mw * mb) / M;
  const k = (mb * l) / M, J = p.bodyInertia + mu * l * l;
  const flightDynamics = (acc) => ({ tau: (Iw * acc) / R });
  const fly = (vx, vy, spin) => {
    const { acc, cmd } = pedalAccel(s, R * spin, input, dt, p, 0, flightDynamics);
    const { tau } = flightDynamics(acc);
    const legV = s.legV + legAccel(mu, l * s.omega * s.omega) * dt, leg = l + legV * dt;
    const kn = (mb * leg) / M;
    const omega = (J * s.omega - tau * dt) / (p.bodyInertia + mu * leg * leg);
    const theta = s.theta + ((s.omega + omega) / 2) * dt;
    // the centre of mass's velocity: the axle's plus that of k up the turning, sliding body axis
    const vcx = vx + (mb / M) * s.legV * sin + k * s.omega * cos, vcy = vy + (mb / M) * s.legV * cos - k * s.omega * sin;
    const cx = s.x + k * sin + vcx * dt, cy = s.y + k * cos + (vcy - (G * dt) / 2) * dt;
    const sn = Math.sin(theta), cs = Math.cos(theta);
    return {
      x: cx - kn * sn, y: cy - kn * cs,
      v: vcx - (mb / M) * legV * sn - kn * omega * cs, vy: vcy - G * dt - (mb / M) * legV * cs + kn * omega * sn,
      theta, omega, wheelOmega: spin + (acc / R) * dt, leg, legV, acc, accCmd: cmd, alpha: (omega - s.omega) / dt, tau,
    };
  };
  if (!s.airborne) {
    const Mt = mw + mb + Iw / (R * R);
    // the part of the terrain under the wheel: its tangent and curvature (arcs over a vertex bend the
    // path down, so the axle accelerates toward the vertex, kappa = −1/R)
    const f = supportFeature(p.track, s.x, R);
    const beta = featureBeta(f, s.x), kappa = f.line ? 0 : -1 / R;
    const sb = Math.sin(beta), cb = Math.cos(beta);
    // the body's angle to the path normal: what the base acceleration along the path acts through
    const sinTB = Math.sin(s.theta + beta), cosTB = Math.cos(s.theta + beta);
    // resistances, signed along the path: rolling (smoothed through v = 0) and air drag on the body;
    // gravity's pull on wheel and body along the slope
    const roll = -p.rollingResistance * (mw + mb) * G * cb * Math.tanh(s.v / 0.1);
    const air = -0.5 * p.airDensity * p.dragArea * s.v * Math.abs(s.v);
    const slopeG = (mw + mb) * G * sb;
    // the body about the axle feels gravity, the axle's acceleration (along the path, plus centripetal
    // kappa·v² on arcs), Coriolis from sliding along its turning axis, pedal reaction −tau and drag
    // moment; along its axis, the legs: mb·(leg'' − leg·omega² + the axle's acceleration along it) =
    // F − mb·G·cos(theta). The wheel along the path: tau/R = Mt·acc + mb·(the body's acceleration
    // along it) + slopeG − roll − air.
    const dynamics = (acc) => {
      const ldd = legAccel(mb, l * s.omega * s.omega - G * cos - acc * sinTB - kappa * s.v * s.v * cosTB);
      const cor = 2 * s.legV * s.omega, radial = ldd - l * s.omega * s.omega;
      const alpha = (mb * l * (G * sin - cosTB * acc + kappa * s.v * s.v * sinTB - cor)
        - R * (Mt * acc + mb * (cor * cosTB + radial * sinTB) + slopeG - roll - air)
        + air * p.dragHeight * cosTB - p.tiltDamping * s.omega)
        / (p.bodyInertia + mb * l * l + R * mb * l * cosTB);
      return { alpha, ldd, tau: R * (Mt * acc + mb * ((cor + l * alpha) * cosTB + radial * sinTB) + slopeG - roll - air) };
    };
    const { acc, cmd } = pedalAccel(s, s.v, input, dt, p, -slopeG / Mt, dynamics);
    const { alpha, ldd, tau } = dynamics(acc);
    // the ground's normal reaction on the wheel: what gives wheel and body their accelerations across
    // the path (centripetal on arcs, the body swinging about the axle and sliding on the legs) against
    // gravity. It can push, not pull: where N < 0 the wheel takes off (keeping its velocity along the
    // path and its spin), as long as, let go for this step, it really leaves the track. If it would
    // not, only the ground's friction, driving the body, is what lifts it, and the wheel stays down.
    const N = (mw + mb) * (G * cb + kappa * s.v * s.v)
      + mb * ((ldd - l * s.omega * s.omega) * cosTB - (2 * s.legV * s.omega + l * alpha) * sinTB);
    const free = N < 0 ? fly(s.v * cb, s.v * sb, s.v / R) : null;
    if (free && !cutsTrack(p.track, free.x, free.y, R)) {
      Object.assign(s, free);
      s.airborne = true;
    } else {
      // semi-implicit Euler
      s.v += acc * dt;
      s.omega += alpha * dt;
      s.legV += ldd * dt;
      rollAlong(s, s.v * cb * dt, f, p);
      s.theta += s.omega * dt;
      s.leg += s.legV * dt;
      s.wheelOmega = s.v / R;
      s.acc = acc; s.accCmd = cmd; s.alpha = alpha; s.tau = tau;
    }
  } else {
    const x0 = s.x, y0 = s.y;
    Object.assign(s, fly(s.v, s.vy, s.wheelOmega));
    touchDown(s, x0, y0, p);
  }
  if (s.leg < p.legMin) bottomOut(s, p);
  s.wheelAngle += s.wheelOmega * dt;
  s.t += dt;
  s.fallen = touchesGround(s, p);
  if (!s.fallen && s.x >= p.finish) s.finished = true;
  return s;
}

/** The point d along the body axis, as drawn with the legs at bodyCom: the body rides on the legs. */
function bodyPoint(s, d, p) {
  const r = d + s.leg - p.bodyCom;
  return { x: s.x + r * Math.sin(s.theta), y: s.y + r * Math.cos(s.theta) };
}

// The wheel against the terrain. The axle can sit wherever the wheel circle stays off the track: on
// the upper envelope of every segment's offset line (R along its normal) and every vertex's arc (R
// around it). The envelope is a path y(x) of lines and convex arcs; where two parts meet in a corner,
// the wheel hits the new part (a valley or an edge); where it jumps up, a wall.
const features = new WeakMap(); // track → { R, list }

/** Parts of the axle path for `track` and wheel radius `R`: offset lines (`line: true`, through
 *  (ax, ay + off) with slope k and angle beta) over x0..x1, and vertex arcs (centre vx, vy, radius R)
 *  strictly inside x0..x1. The arcs stop TOUCH short of their ends, so a wheel up against a wall face
 *  stands on the ground below it, not on the wall's top. */
function wheelFeatures(track, R) {
  const hit = features.get(track);
  if (hit && hit.R === R) return hit.list;
  const first = track[0], last = track[track.length - 1];
  const pts = [[first[0] - FAR, first[1]], ...track, [last[0] + FAR, last[1]]];
  const list = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if (bx <= ax) continue; // walls: their faces are covered by the vertex arcs at their ends
    const beta = Math.atan2(by - ay, bx - ax), shift = R * Math.sin(beta);
    list.push({ line: true, x0: ax - shift, x1: bx - shift, ax, ay, k: (by - ay) / (bx - ax), off: R / Math.cos(beta), beta });
  }
  for (const [vx, vy] of track) list.push({ line: false, x0: vx - R + TOUCH, x1: vx + R - TOUCH, vx, vy, R });
  features.set(track, { R, list });
  return list;
}

function inDomain(f, x) {
  return f.line ? f.x0 <= x && x <= f.x1 : f.x0 < x && x < f.x1;
}

function featureY(f, x) {
  if (f.line) return f.ay + f.k * (x - f.ax) + f.off;
  const d = x - f.vx;
  return f.vy + Math.sqrt(Math.max(0, f.R * f.R - d * d));
}

/** Angle of the path tangent with +x at x on feature f. */
function featureBeta(f, x) {
  return f.line ? f.beta : Math.atan2(f.vx - x, featureY(f, x) - f.vy);
}

/** The feature the wheel rests on at x: the highest one there. */
function supportFeature(track, x, R) {
  let best = null, bestY = -Infinity;
  for (const f of wheelFeatures(track, R)) {
    if (!inDomain(f, x)) continue;
    const y = featureY(f, x);
    if (y > bestY) { best = f; bestY = y; }
  }
  return best;
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

// Impacts: the contact impulse acts on the wheel only. The body hangs on a pin and rides on the legs,
// which deliver finite torque and force, so none of them passes an impulse: momentum conjugate to every
// motion the contact still allows (the body's pitch and its slide on the legs among them) is
// conserved, the rest is lost. Impacts never add energy.

/** The wheel, moving with axle velocity (vx, vy) and spin `spin` (rad/s, + rolling toward +x), hits
 *  terrain it then rolls along at angle beta: sets the rolling speed v, the body's omega and the
 *  legs' legV. With `locked` legs (at their stop) the body slides on them no more: legV = 0. */
function rollOnto(s, beta, vx, vy, spin, p, locked = false) {
  const R = p.wheelRadius, mw = p.wheelMass, mb = p.bodyMass, l = s.leg;
  const Iw = mw * R * R, Mt = mw + mb + Iw / (R * R), I = p.bodyInertia + mb * l * l;
  const c = mb * l * Math.cos(s.theta + beta), d = mb * Math.sin(s.theta + beta), dAfter = locked ? 0 : d;
  const sin = Math.sin(s.theta), cos = Math.cos(s.theta);
  // momenta conjugate to rolling along beta, body pitch and the legs; after the impact they are
  // Mt·v + c·omega + d·legV, c·v + I·omega and d·v + mb·legV
  const pRoll = (mw + mb) * (vx * Math.cos(beta) + vy * Math.sin(beta)) + (Iw * spin) / R + c * s.omega + d * s.legV;
  const pPitch = mb * l * (vx * cos - vy * sin) + I * s.omega;
  const pLeg = mb * (vx * sin + vy * cos + s.legV);
  s.v = (pRoll - (c * pPitch) / I - (dAfter * pLeg) / mb) / (Mt - (c * c) / I - (dAfter * dAfter) / mb);
  s.omega = (pPitch - c * s.v) / I;
  s.legV = locked ? 0 : (pLeg - d * s.v) / mb;
}

/** The wheel, moving with axle velocity (vx, vy), is stopped dead by an edge: the body keeps its
 *  angular momentum about the axle, so the momentum of the stopped motion pitches it forward, and
 *  its momentum along its axis, which it carries on into the legs. */
function stopAgainst(s, vx, vy, p) {
  const mb = p.bodyMass, l = s.leg, sin = Math.sin(s.theta), cos = Math.cos(s.theta);
  s.omega += (mb * l * (vx * cos - vy * sin)) / (p.bodyInertia + mb * l * l);
  s.legV += vx * sin + vy * cos;
  s.v = 0;
}

/** The legs bottom out at legMin: an inelastic stop along the body axis (legV → 0), not a fall. In
 *  flight the clamp preserves the centre of mass's position and velocity, angular momentum and wheel
 *  spin; on the ground the wheel rolls on (rollOnto with the legs locked). */
function bottomOut(s, p) {
  const l = s.leg;
  s.leg = p.legMin;
  if (s.airborne) {
    const f = p.bodyMass / (p.wheelMass + p.bodyMass), mu = p.wheelMass * f;
    const sin = Math.sin(s.theta), cos = Math.cos(s.theta), omega = s.omega;
    s.omega *= (p.bodyInertia + mu * l * l) / (p.bodyInertia + mu * s.leg * s.leg);
    const shift = f * (l - s.leg), radial = f * Math.min(s.legV, 0);
    const tangent = f * (l * omega - s.leg * s.omega);
    s.x += shift * sin; s.y += shift * cos;
    s.v += radial * sin + tangent * cos; s.vy += radial * cos - tangent * sin;
    s.legV = Math.max(s.legV, 0);
  } else {
    if (s.legV >= 0) return;
    const R = p.wheelRadius, beta = featureBeta(supportFeature(p.track, s.x, R), s.x);
    rollOnto(s, beta, s.v * Math.cos(beta), s.v * Math.sin(beta), s.v / R, p, true);
    s.vy = s.v * Math.sin(beta); s.wheelOmega = s.v / R;
    s.legV = 0;
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

/** The wheel with its axle at (x, y) cuts into the track, deeper than TOUCH. */
function cutsTrack(track, x, y, R) {
  return nearestOnTrack(track, x, y).d < R - TOUCH;
}

/** Terrain height under x: linear along the track polyline, level beyond its ends. */
function groundY(track, x) {
  if (x <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [x1, y1] = track[i];
    if (x <= x1) {
      const [x0, y0] = track[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return track[track.length - 1][1];
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

/** The two arm joints shared by rendering and terrain contact, in world coordinates. */
function armPoints(s, shoulder, side) {
  const a = s.theta + Math.PI + side * 1.1;
  const elbow = { x: shoulder.x + Math.sin(a) * ARM * 0.5, y: shoulder.y + Math.cos(a) * ARM * 0.5 };
  const a2 = a - side * 0.4;
  const hand = { x: elbow.x + Math.sin(a2) * ARM * 0.5, y: elbow.y + Math.cos(a2) * ARM * 0.5 };
  return { elbow, hand };
}

/** The point of the track polyline (extended level beyond its ends) nearest to (x, y): { x, y, d }. */
function nearestOnTrack(track, x, y) {
  const c = { x, y };
  let best = null;
  for (let i = -1; i < track.length; i++) {
    const q = closestOnSegment(c, trackPoint(track, i), trackPoint(track, i + 1));
    q.d = Math.hypot(x - q.x, y - q.y);
    if (!best || q.d < best.d) best = q;
  }
  return best;
}

/** Track point i as { x, y }; i = −1 and i = length are the level extensions FAR past its ends. */
function trackPoint(track, i) {
  const [x, y] = track[Math.max(0, Math.min(track.length - 1, i))];
  return { x: i < 0 ? x - FAR : i >= track.length ? x + FAR : x, y };
}

const FAR = 1e6; // m, how far the track runs level past its end points
const TOUCH = 1e-9; // m, how far the wheel may sink into the track and still only touch it

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Segments pq and ab intersect or touch. */
function crosses(p, q, a, b) {
  if (Math.max(p.x, q.x) < Math.min(a.x, b.x) || Math.max(a.x, b.x) < Math.min(p.x, q.x)
    || Math.max(p.y, q.y) < Math.min(a.y, b.y) || Math.max(a.y, b.y) < Math.min(p.y, q.y)) return false;
  return cross(a, b, p) * cross(a, b, q) <= 0 && cross(p, q, a) * cross(p, q, b) <= 0;
}

/** The point of segment ab nearest to c. */
function closestOnSegment(c, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + k * dx, y: a.y + k * dy };
}

function distToSegment(c, a, b) {
  const q = closestOnSegment(c, a, b);
  return Math.hypot(c.x - q.x, c.y - q.y);
}

export class UnicycleGame {
  constructor(container, params = {}) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    this.canvas.tabIndex = 0; // receives keys only when focused — safe to embed
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.keys = new Set();
    this.menu = true; // start screen: pick a level (↑/↓ or click), Enter/Space/click starts; Esc in game returns here
    this.levels = null; // [{ name, points: [[x, y], …], start, finish }], fetched from levelUrls
    this.level = null; // the level picked in the menu (selectLevel)
    this.bestTimes = loadBestTimes(); // level name → best finish time, s; kept in localStorage
    this.result = null; // the last finish, shown in the menu: { name, time, record }
    this.run = 0;   // attempts so far; reset() starts the next one
    this.log = [];  // samples of the whole session; `run` column separates attempts
    this.s = createState(0, this.p); // the rider shown behind the menu
    Promise.all(this.p.levelUrls.map((url) => fetch(url).then((r) => r.json()))).then((levels) => {
      this.levels = levels;
      this.selectLevel(0);
    }).catch(() => { this.levelError = true; }); // e.g. opened via file:// instead of the dev server

    this._onKey = (e) => {
      if (e.code === 'KeyL' && e.type === 'keydown') { e.preventDefault(); this.downloadLog(); return; }
      if (e.type === 'keydown' && this.menu && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); this._startKey = e.code; this.startGame(); return; }
      if (e.type === 'keydown' && this.menu && this.levels && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); this.selectLevel(this.levelIndex + (e.code === 'ArrowUp' ? -1 : 1)); return; }
      // the key that started the game (Space is also jump) does nothing until it is released
      if (e.code === this._startKey) { e.preventDefault(); if (e.type === 'keyup') this._startKey = null; return; }
      if (e.type === 'keydown' && !this.menu && e.code === 'Escape') { e.preventDefault(); this.menu = true; this.keys.clear(); return; }
      const k = KEY_MAP[e.code];
      if (!k) return;
      e.preventDefault();
      e.type === 'keydown' ? this.keys.add(k) : this.keys.delete(k);
    };
    this._onBlur = () => { this.keys.clear(); this._startKey = null; };
    this._onResize = () => this.resize();
    this.canvas.addEventListener('keydown', this._onKey);
    this.canvas.addEventListener('keyup', this._onKey);
    this.canvas.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus();
      if (!this.menu) return;
      const row = this.levels?.findIndex((_, i) => Math.abs(e.offsetY - this.menuRowY(i)) < MENU_ROW / 2) ?? -1;
      if (row >= 0) this.selectLevel(row);
      this.startGame();
    });
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(container);
    this.resize();
  }

  /** Make level i (wrapping around) the current one: its track and finish go into the physics params,
   *  and the rider waits at its start. */
  selectLevel(i) {
    this.levelIndex = (i + this.levels.length) % this.levels.length;
    this.level = this.levels[this.levelIndex];
    this.p.track = this.level.points;
    this.p.finish = this.level.finish;
    this.s = createState(this.level.start, this.p);
  }

  startGame() {
    if (!this.level) return;
    this.reset(); // every start is a fresh attempt, with its own `run` number in the log
    this.menu = false;
    this.result = null;
  }

  /** The finish line is crossed: record the time, keep it if it is the level's best, back to the menu. */
  finishRun() {
    const { name } = this.level, time = this.s.t;
    const record = !(this.bestTimes[name] <= time);
    if (record) { this.bestTimes[name] = time; saveBestTimes(this.bestTimes); }
    this.result = { name, time, record };
    if (this.p.consoleLog) console.log(`[unicycle] run ${this.run} finished ${name} in ${time.toFixed(2)}s${record ? ' (best)' : ''}`);
    this.menu = true;
    this.keys.clear();
  }

  /** Screen y of the menu's row for level i, px. */
  menuRowY(i) {
    return this.h * 0.4 + i * MENU_ROW;
  }

  reset() {
    this.s = createState(this.level.start, this.p);
    this.acc = 0;
    this.run++;
    this.lastInput = 0;
    this.stepCount = 0;
  }

  record(input) {
    const s = this.s;
    this.log.push({
      run: this.run,
      t: +s.t.toFixed(4), input, x: +s.x.toFixed(4), v: +s.v.toFixed(4), acc: +s.acc.toFixed(3),
      y: +s.y.toFixed(4), vy: +s.vy.toFixed(4), wheelOmega: +s.wheelOmega.toFixed(4),
      airborne: s.airborne ? 1 : 0, charge: +s.charge.toFixed(4), level: this.levelIndex,
      thetaDeg: +(s.theta * 180 / Math.PI).toFixed(3), omega: +s.omega.toFixed(4),
      alpha: +s.alpha.toFixed(3), tau: +s.tau.toFixed(2),
    });
  }

  /** CSV of the whole session (all attempts). */
  exportLog() {
    return toCsv(this.log, true);
  }

  /** Send rows recorded since the last flush to `logEndpoint` (appended server-side). */
  flushLog(beacon = false) {
    if (!this.p.logEndpoint || this.sent === this.log.length) return;
    const body = toCsv(this.log.slice(this.sent), this.sent === 0) + '\n';
    this.sent = this.log.length;
    const url = `${this.p.logEndpoint}?session=${this.session}`;
    if (beacon) navigator.sendBeacon(url, body);
    else fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  }

  downloadLog() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.exportLog()], { type: 'text/csv' }));
    a.download = `unicycle-session-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  start() {
    this.canvas.focus();
    if (this.p.logEndpoint) {
      this.session = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      this.sent = 0;
      this._flushTimer = setInterval(() => this.flushLog(), 1000);
      this._onHide = () => this.flushLog(true);
      window.addEventListener('pagehide', this._onHide);
      console.log(`[unicycle] streaming log to logs/${this.session}.csv`);
    }
    let last = performance.now();
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.render();
    };
    this._raf = requestAnimationFrame(frame);
    return this;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._flushTimer);
    if (this._onHide) { this.flushLog(true); window.removeEventListener('pagehide', this._onHide); }
    this._ro.disconnect();
    this.canvas.remove();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
  }

  update(dt) {
    if (this.menu) return;
    if (this.s.fallen) { this.reset(); return; } // restart immediately, stay in game
    const input = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    const jump = this.keys.has('jump');
    const H = 1 / 240;
    this.acc += dt * this.p.timeScale;
    while (this.acc >= H && !this.s.fallen && !this.s.finished) {
      const airborne = this.s.airborne;
      step(this.s, input, jump, H, this.p);
      this.acc -= H;
      // 60 Hz samples + every pedal input change, take-off and touchdown
      if (this.stepCount++ % 4 === 0 || input !== this.lastInput || airborne !== this.s.airborne) this.record(input);
      if (input !== this.lastInput && this.p.consoleLog) {
        const s = this.s;
        console.log(`[unicycle] t=${s.t.toFixed(2)} input ${this.lastInput}→${input} v=${s.v.toFixed(2)} θ=${(s.theta * 180 / Math.PI).toFixed(1)}° ω=${s.omega.toFixed(2)}`);
      }
      this.lastInput = input;
    }
    if (this.s.fallen || this.s.finished) {
      this.record(input);
      if (this.s.fallen && this.p.consoleLog) {
        console.log(`[unicycle] run ${this.run} fell at t=${this.s.t.toFixed(2)}s x=${this.s.x.toFixed(2)}m; last 1s:`);
        console.table(this.log.filter((r) => r.run === this.run && r.t > this.s.t - 1));
      }
      window.unicycleLog = this.log; // whole session, for devtools analysis
      this.flushLog();
      if (this.s.finished) this.finishRun();
    }
  }

  render() {
    const { ctx, w, h, s, p } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const scale = Math.min(w, h * 1.6) / 6; // px per meter
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

    this.drawRider(P, scale);

    // HUD
    ctx.fillStyle = '#123'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
    const best = this.level && this.bestTimes[this.level.name];
    if (this.level) ctx.fillText(`${this.level.name}   Time: ${s.t.toFixed(2)} s   Best: ${best ? best.toFixed(2) + ' s' : '—'}   To the finish: ${Math.max(0, p.finish - s.x).toFixed(0)} m`, 12, 22);
    ctx.fillText('← → / A D — pedal,  ↑ / W / Space — jump (hold to charge),  L — download physics log (CSV)', 12, 42);
    ctx.font = '12px monospace'; ctx.fillStyle = '#345';
    ctx.fillText(`v=${s.v.toFixed(2)} m/s  a=${s.acc.toFixed(2)}  θ=${(s.theta * 180 / Math.PI).toFixed(1)}°  ω=${s.omega.toFixed(2)}  α=${s.alpha.toFixed(2)}  τ=${s.tau.toFixed(0)} N·m`, 12, 62);
    // jump charge: fills while jump is held, lit orange during the push-off
    ctx.fillText('jump', 12, 82);
    ctx.strokeStyle = '#345'; ctx.lineWidth = 1; ctx.strokeRect(50.5, 72.5, 120, 12);
    ctx.fillStyle = s.push > 0 ? '#ef6c00' : '#1565c0'; ctx.fillRect(52, 74, 117 * s.charge, 9);
    if (this.menu) {
      ctx.fillStyle = 'rgba(10,20,30,0.55)'; ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px sans-serif'; ctx.fillText('UNICYCLE DEFEAT', w / 2, h * 0.2);
      if (this.result) {
        const { name, time, record } = this.result;
        ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = record ? '#ffd54f' : '#fff';
        ctx.fillText(`${name}: finished in ${time.toFixed(2)} s${record ? ' — new best!' : ''}`, w / 2, h * 0.28);
        ctx.fillStyle = '#fff';
      }
      if (!this.levels) {
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(this.levelError ? 'Levels failed to load — run node dev-server.js' : 'Loading levels…', w / 2, this.menuRowY(0));
      }
      this.levels?.forEach((level, i) => {
        const y = this.menuRowY(i), on = i === this.levelIndex, best = this.bestTimes[level.name];
        if (on) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(w / 2 - 220, y - MENU_ROW / 2, 440, MENU_ROW); ctx.fillStyle = '#fff'; }
        ctx.font = `${on ? 'bold ' : ''}22px sans-serif`;
        ctx.fillText(`${on ? '▶ ' : ''}${i + 1}. ${level.name}   best: ${best ? `${best.toFixed(2)} s` : '—'}`, w / 2, y + 8);
      });
      const y = this.menuRowY(this.levels?.length ?? 1) + 16;
      ctx.font = '14px sans-serif'; ctx.fillText('↑ / ↓ — pick a level,  Enter / Space / click — start,  Esc in game — back to menu', w / 2, y);
    }
  }

  drawRider(P, scale) {
    const { ctx, s, p } = this;
    const R = p.wheelRadius;
    const sn = Math.sin(s.theta), cs = Math.cos(s.theta);
    const axX = s.x, axY = s.y;
    const along = (d, side = 0) => [axX + d * sn + side * cs, axY + d * cs - side * sn];
    const S = ([x, y]) => P(x, y);
    const wheelAngle = s.wheelAngle; // the wheel's own spin (rolling on the ground, free in the air); + is clockwise on screen
    const axle = [axX, axY];
    const crank = p.crankLength;
    const pedal = (phase) => [axX + crank * Math.cos(wheelAngle + phase), axY - crank * Math.sin(wheelAngle + phase)];
    const pedalR = pedal(0), pedalL = pedal(Math.PI);
    // the body (seat included) rides on the legs: bent legs lower it toward the wheel
    const body = (d, side = 0) => along(d + s.leg - p.bodyCom, side);
    const hip = body(SEAT + 0.05), shoulder = body(SHOULDER), head = body(HEAD);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // far leg (behind wheel)
    this.drawLeg(S, hip, pedalL, '#37474f', scale);

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
    this.drawLeg(S, hip, pedalR, '#263238', scale);
  }

  drawLeg(S, hip, foot, color, scale) {
    const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
    const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 1e-3);
    // knee forward (+x direction of travel): two-bone IK
    const a = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
    const base = Math.atan2(dy, dx);
    const ka = base + a;
    const knee = [hip[0] + Math.cos(ka) * THIGH, hip[1] + Math.sin(ka) * THIGH];
    const { ctx } = this;
    ctx.strokeStyle = color; ctx.lineWidth = scale * 0.07;
    ctx.beginPath(); ctx.moveTo(...S(hip)); ctx.lineTo(...S(knee)); ctx.lineTo(...S(foot)); ctx.stroke();
  }
}

const KEY_MAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};

const MENU_ROW = 36; // px, height of a level's row in the menu

// Best finish times by level name, s, kept in localStorage. Storage may be unavailable (e.g. blocked
// in an embed): then times last for the session only.
const BEST_TIMES_KEY = 'unicycle-defeat.bestTimes';
function loadBestTimes() {
  try { return JSON.parse(localStorage.getItem(BEST_TIMES_KEY)) ?? {}; } catch { return {}; }
}
function saveBestTimes(times) {
  try { localStorage.setItem(BEST_TIMES_KEY, JSON.stringify(times)); } catch { /* session only */ }
}

const LOG_COLS = ['run', 't', 'input', 'x', 'v', 'acc', 'thetaDeg', 'omega', 'alpha', 'tau', 'y', 'vy', 'wheelOmega', 'airborne', 'charge', 'level'];
function toCsv(rows, header) {
  const lines = rows.map((r) => LOG_COLS.map((c) => r[c]).join(','));
  return (header ? [LOG_COLS.join(','), ...lines] : lines).join('\n');
}

function line(ctx, [x1, y1], [x2, y2]) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function poly(ctx, pts, fill) {
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
