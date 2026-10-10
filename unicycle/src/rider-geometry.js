// Body geometry: distances along the body axis from the axle with the legs at bodyCom, m; the body
// rides on the legs, so it sits `leg − bodyCom` further out.
export const SEAT = 0.75, SHOULDER = 1.3, HEAD = 1.47, HEAD_R = 0.13;
export const THIGH = 0.46, SHIN = 0.46;
const ARM = 0.6;

/** The point d along the body axis, as drawn with the legs at bodyCom: the body rides on the legs. */
export function bodyPoint(s, d, p) {
  const r = d + s.leg - p.bodyCom;
  return { x: s.x + r * Math.sin(s.theta), y: s.y + r * Math.cos(s.theta) };
}

/** The two arm joints shared by rendering and terrain contact, in world coordinates. */
export function armPoints(s, shoulder, side) {
  const a = s.theta + Math.PI + side * 1.1;
  const elbow = { x: shoulder.x + Math.sin(a) * ARM * 0.5, y: shoulder.y + Math.cos(a) * ARM * 0.5 };
  const a2 = a - side * 0.4;
  const hand = { x: elbow.x + Math.sin(a2) * ARM * 0.5, y: elbow.y + Math.cos(a2) * ARM * 0.5 };
  return { elbow, hand };
}
