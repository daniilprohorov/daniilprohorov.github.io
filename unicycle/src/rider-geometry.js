// Rider distances at the neutral leg length; the seat and hip follow the lower link,
// while the upper body rotates about the hip independently.
export const SEAT = 0.75, HIP = SEAT + 0.05, SHOULDER = 1.3, HEAD = 1.47, HEAD_R = 0.13;
export const THIGH = 0.46, SHIN = 0.46;
const ARM = 0.6;

/** Shared drawing/contact point: lower link below the hip, torso above it. */
export function bodyPoint(s, d, p) {
  const r = Math.min(d, HIP) + s.leg - p.bodyCom;
  const upper = Math.max(0, d - HIP);
  return {
    x: s.x + r * Math.sin(s.theta) + upper * Math.sin(s.torsoTheta),
    y: s.y + r * Math.cos(s.theta) + upper * Math.cos(s.torsoTheta),
  };
}

/** The two arm joints shared by rendering and terrain contact, in world coordinates. */
export function armPoints(s, shoulder, side) {
  const a = s.torsoTheta + Math.PI + side * 1.1;
  const elbow = { x: shoulder.x + Math.sin(a) * ARM * 0.5, y: shoulder.y + Math.cos(a) * ARM * 0.5 };
  const a2 = a - side * 0.4;
  const hand = { x: elbow.x + Math.sin(a2) * ARM * 0.5, y: elbow.y + Math.cos(a2) * ARM * 0.5 };
  return { elbow, hand };
}
