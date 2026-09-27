export const ROUND_DURATION_MS = 120_000;

export function getRemainingSeconds(startedAt: number, now: number, duration = ROUND_DURATION_MS) {
  return Math.max(0, Math.ceil((startedAt + duration - now) / 1000));
}

