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

export function inDomain(f, x) {
  return f.line ? f.x0 <= x && x <= f.x1 : f.x0 < x && x < f.x1;
}

export function featureY(f, x) {
  if (f.line) return f.ay + f.k * (x - f.ax) + f.off;
  const d = x - f.vx;
  return f.vy + Math.sqrt(Math.max(0, f.R * f.R - d * d));
}

/** Angle of the path tangent with +x at x on feature f. */
export function featureBeta(f, x) {
  return f.line ? f.beta : Math.atan2(f.vx - x, featureY(f, x) - f.vy);
}

/** The feature the wheel rests on at x: the highest one there. */
export function supportFeature(track, x, R) {
  let best = null, bestY = -Infinity;
  for (const f of wheelFeatures(track, R)) {
    if (!inDomain(f, x)) continue;
    const y = featureY(f, x);
    if (y > bestY) { best = f; bestY = y; }
  }
  return best;
}

/** The wheel with its axle at (x, y) cuts into the track, deeper than TOUCH. */
export function cutsTrack(track, x, y, R) {
  return nearestOnTrack(track, x, y).d < R - TOUCH;
}

/** Terrain height under x: linear along the track polyline, level beyond its ends. */
export function groundY(track, x) {
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

/** The point of the track polyline (extended level beyond its ends) nearest to (x, y): { x, y, d }. */
export function nearestOnTrack(track, x, y) {
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
export function trackPoint(track, i) {
  const [x, y] = track[Math.max(0, Math.min(track.length - 1, i))];
  return { x: i < 0 ? x - FAR : i >= track.length ? x + FAR : x, y };
}

const FAR = 1e6; // m, how far the track runs level past its end points
const TOUCH = 1e-9; // m, how far the wheel may sink into the track and still only touch it

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Segments pq and ab intersect or touch. */
export function crosses(p, q, a, b) {
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

export function distToSegment(c, a, b) {
  const q = closestOnSegment(c, a, b);
  return Math.hypot(c.x - q.x, c.y - q.y);
}
