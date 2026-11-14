export const HUD = Object.freeze({width: .90, height: .74, depth: 1.8});

// A conservative window inside both eyes' projection frusta. The angle caps
// are UI comfort choices rather than assumed headset hardware specifications.
export function comfortAnchor(projections = []) {
  let horizontal = 25 * Math.PI / 180, vertical = 18 * Math.PI / 180;
  for (const p of projections) {
    if (!p || !(p[0] > 0) || !(p[5] > 0)) continue;
    const h = Math.atan(Math.max(.01, 1 - Math.abs(p[8] || 0)) / p[0]);
    const v = Math.atan(Math.max(.01, 1 - Math.abs(p[9] || 0)) / p[5]);
    horizontal = Math.min(horizontal, h * .62);
    vertical = Math.min(vertical, v * .58);
  }
  return {x: Math.max(.12, Math.tan(horizontal) * HUD.depth - HUD.width / 2),
    y: Math.tan(vertical) * HUD.depth - HUD.height / 2, z: -HUD.depth};
}
