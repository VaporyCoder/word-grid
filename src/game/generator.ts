import type { BoardSize, GeneratedBoard } from "./types";
import type { TrieNode } from "./trie";
import { solveBoard } from "./solver";

const LETTERS = "eeeeeeeeeeeeaaaaaaaaaiiiiiiiiioooooooonnnnnnrrrrrrttttttllllsssssuuuuddddgggbbccmmppffhhvvwwyykjxqz";
const VOWELS = "aeiou";
const CLUSTERS = ["th", "he", "in", "er", "an", "re", "on", "at", "en", "nd", "st", "or", "te", "ar", "it", "is", "ou", "ea", "ng", "as"];
const TARGETS: Record<BoardSize, number> = { 4: 100, 5: 230, 6: 420 };
const ATTEMPTS: Record<BoardSize, number> = { 4: 38, 5: 22, 6: 12 };

function pick(source: string) {
  return source[Math.floor(Math.random() * source.length)]!;
}

function makeLetters(size: BoardSize) {
  const total = size * size;
  const letters = Array.from({ length: total }, () => pick(LETTERS));
  const vowelGoal = Math.round(total * (0.38 + Math.random() * 0.08));
  const vowelIndexes = letters.flatMap((letter, index) => VOWELS.includes(letter) ? [index] : []);
  while (vowelIndexes.length < vowelGoal) {
    const index = Math.floor(Math.random() * total);
    if (!VOWELS.includes(letters[index]!)) {
      letters[index] = pick(VOWELS);
      vowelIndexes.push(index);
    }
  }
  // Plant a few high-value English transitions without forcing whole words.
  for (let i = 0; i < size; i += 1) {
    const cluster = CLUSTERS[Math.floor(Math.random() * CLUSTERS.length)]!;
    const first = Math.floor(Math.random() * total);
    const row = Math.floor(first / size);
    const col = first % size;
    const options = [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => [row + dr, col + dc] as const))
      .filter(([r, c]) => (r !== row || c !== col) && r >= 0 && c >= 0 && r < size && c < size);
    const [nextRow, nextCol] = options[Math.floor(Math.random() * options.length)]!;
    letters[first] = cluster[0]!;
    letters[nextRow * size + nextCol] = cluster[1]!;
  }
  return letters;
}

export function generateBoard(size: BoardSize, trie: TrieNode): GeneratedBoard {
  let bestLetters: string[] = [];
  let bestWords = new Set<string>();
  let usedAttempts = 0;
  for (let attempt = 1; attempt <= ATTEMPTS[size]; attempt += 1) {
    const letters = makeLetters(size);
    const words = solveBoard(letters, size, trie);
    usedAttempts = attempt;
    if (words.size > bestWords.size) {
      bestLetters = letters;
      bestWords = words;
    }
    if (words.size >= TARGETS[size]) break;
  }
  return { letters: bestLetters, size, words: [...bestWords], attempts: usedAttempts };
}

