// Circle versus axis-aligned boxes. Coordinates are three.js X/Z in metres.
export function collides(x, z, world, extra = []) {
  const r = world.playerRadius;
  for (const list of [world.obstacles, extra]) {
    for (const b of list) {
      const dx = x - Math.max(b.min[0], Math.min(b.max[0], x));
      const dz = z - Math.max(b.min[1], Math.min(b.max[1], z));
      if (dx * dx + dz * dz < r * r - 1e-9) return true;
    }
  }
  return false;
}
export function moveCircle(x, z, dx, dz, world, extra = []) {
  if (collides(x, z, world, extra)) { // stuck (e.g. door closed on us): just let the player move out freely
    return [x + dx, z + dz];
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .03));
  dx /= steps; dz /= steps;
  for (let i = 0; i < steps; i++) {
    if (!collides(x + dx, z, world, extra)) x += dx;
    if (!collides(x, z + dz, world, extra)) z += dz;
  }
  return [x, z];
}
