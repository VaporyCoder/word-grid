import { CARD_COLORS, type Card, type CardColor, type CardValue } from "./types";

export function isWild(card: Card): boolean {
  return card.value === "wild" || card.value === "wild-draw-four";
}

export function isActionCard(card: Card): boolean {
  return card.value === "skip" || card.value === "reverse" || card.value === "draw-two";
}

export function isPlayable(card: Card, topDiscard: Card, activeColor: CardColor): boolean {
  return isWild(card) || card.color === activeColor || card.value === topDiscard.value;
}

export function isCardColor(value: string): value is CardColor {
  return (CARD_COLORS as readonly string[]).includes(value);
}

export function cardLabel(value: CardValue): string {
  const labels: Record<CardValue, string> = {
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    skip: "Skip", reverse: "Reverse", "draw-two": "Draw Two", wild: "Wild", "wild-draw-four": "Wild Draw Four",
  };
  return labels[value];
}
