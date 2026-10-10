import { featureY, featureBeta, supportFeature, inDomain, cutsTrack, nearestOnTrack, trackPoint, crosses, distToSegment } from './terrain.js';
import { SEAT, SHOULDER, HEAD, HEAD_R, bodyPoint, armPoints } from './rider-geometry.js';

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
  maxCadence: 200,     // rpm, cadence at which the legs can no longer push the wheel forward
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
