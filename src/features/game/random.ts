export type RandomStep = { value: number; seed: number };

export function nextRandom(seed: number): RandomStep {
  const normalized = seed >>> 0 || 1;
  const nextSeed = (Math.imul(normalized, 1664525) + 1013904223) >>> 0;
  return { value: nextSeed / 4294967296, seed: nextSeed };
}

export function shuffleWithSeed<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const shuffled = [...items];
  let currentSeed = seed;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const step = nextRandom(currentSeed);
    currentSeed = step.seed;
    const swapIndex = Math.floor(step.value * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return { items: shuffled, seed: currentSeed };
}
