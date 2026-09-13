/** Bounded turn in radians. Equal screen distances have equal response on every axis. */
export function pointerTurn(x: number, y: number, radius: number): { x: number; y: number } {
  if (![x, y, radius].every(Number.isFinite)) return { x: 0, y: 0 }
  const distance = Math.hypot(x, y)
  if (distance < 1e-8 || radius <= 0) return { x: 0, y: 0 }
  const gain = .95 * Math.tanh(distance / (radius * 1.5)) / distance
  return { x: x * gain, y: y * gain }
}
