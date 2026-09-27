export function scoreWord(word: string) {
  const scores: Record<number, number> = { 3: 100, 4: 400, 5: 800, 6: 1400, 7: 1800, 8: 2200 };
  return scores[word.length] ?? (word.length >= 9 ? 2600 : 0);
}

