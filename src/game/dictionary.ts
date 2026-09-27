import words from "an-array-of-english-words";

const BLOCKED = new Set(["fag", "fags", "nigga", "nigger", "cunt", "cunts"]);
const HAS_VOWEL = /[aeiouy]/;

export function loadDictionary() {
  return (words as string[]).filter((word) =>
    word.length >= 3 && word.length <= 14 && /^[a-z]+$/.test(word) && HAS_VOWEL.test(word) && !BLOCKED.has(word),
  );
}

