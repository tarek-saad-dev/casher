/**
 * Spread a package's own duration across its required lines (proportional to
 * catalog minutes) so BookingServices.DurationMinutes sums to exactly the package
 * duration — readers derive the booking length from that sum.
 */
export function fitLineDurationsToPackage<T extends { durationMinutes: number }>(
  lines: T[],
  packageDurationMinutes: number,
): T[] {
  if (!lines.length) return lines;
  const total = Math.max(0, Math.trunc(packageDurationMinutes));
  const weights = lines.map((l) => Math.max(0, l.durationMinutes));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const shares = weightSum > 0
    ? weights.map((w) => (w / weightSum) * total)
    : lines.map(() => total / lines.length);
  const floors = shares.map(Math.floor);
  let remainder = total - floors.reduce((s, n) => s + n, 0);
  const order = shares
    .map((s, i) => ({ i, frac: s - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return lines.map((l, i) => ({ ...l, durationMinutes: floors[i] }));
}
