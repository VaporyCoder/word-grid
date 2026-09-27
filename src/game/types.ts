export type BoardSize = 4 | 5 | 6;

export type GeneratedBoard = {
  letters: string[];
  size: BoardSize;
  words: string[];
  attempts: number;
};

export type GameStats = {
  gamesPlayed: number;
  highestScore: number;
  mostWords: number;
  longestWord: string;
  highScores: Record<BoardSize, number>;
};

