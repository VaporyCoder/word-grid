import { ACTION_VALUES, CARD_COLORS, NUMBER_VALUES, WILD_VALUES, type Card } from "./types";
import { shuffleWithSeed } from "./random";

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const color of CARD_COLORS) {
    cards.push({ id: `${color}-0-1`, color, value: "0" });
    for (const value of NUMBER_VALUES.slice(1)) {
      for (let copy = 1; copy <= 2; copy += 1) cards.push({ id: `${color}-${value}-${copy}`, color, value });
    }
    for (const value of ACTION_VALUES) {
      for (let copy = 1; copy <= 2; copy += 1) cards.push({ id: `${color}-${value}-${copy}`, color, value });
    }
  }
  for (const value of WILD_VALUES) {
    for (let copy = 1; copy <= 4; copy += 1) cards.push({ id: `${value}-${copy}`, color: null, value });
  }
  return cards;
}

export function shuffleDeck(seed: number): { deck: Card[]; seed: number } {
  const shuffled = shuffleWithSeed(createDeck(), seed);
  return { deck: shuffled.items, seed: shuffled.seed };
}
