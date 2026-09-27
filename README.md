# LexiGrid

LexiGrid is a polished, local-first word-tracing game built with React, TypeScript, and Vite. Pick a 4×4, 5×5, or 6×6 grid and find as many words as possible in exactly two minutes.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Use `npm test` for the logic test suite and `npm run build` for a production build.

## Rules

- Drag through horizontally, vertically, or diagonally adjacent letters.
- Change direction after any letter.
- A tile can appear only once in a word and becomes available again after submission.
- Words must have at least three letters. Repeats are rejected.
- Releasing the pointer submits the word automatically.
- Every round lasts exactly 120 seconds.

Scoring: 3 letters = 100, 4 = 400, 5 = 800, 6 = 1,400, 7 = 1,800, 8 = 2,200, and 9+ = 2,600.

## Architecture

- `src/app` — the menu, round, and results state machine
- `src/game` — pure trie, solver, generator, scoring, timer, and types
- `src/game/board.worker.ts` — off-main-thread dictionary indexing and board generation
- `src/styles` — responsive visual system and motion
- `src/test` and `src/game/*.test.ts` — interface and game-rule coverage

## Dictionary

The game loads the MIT-licensed `an-array-of-english-words` package locally. `dictionary.ts` is the swappable adapter: it normalizes words, accepts alphabetic entries from 3–14 letters, removes entries without a vowel-like letter, and blocks a small set of obvious slurs. No network request is made during play.

## Board generation and search

Boards use weighted English letter frequencies, enforce a healthy vowel ratio, and plant common two-letter transitions. Every candidate is evaluated with the same solver used for gameplay. The generator targets at least 100 words on 4×4, 230 on 5×5, and 420 on 6×6, with a strict attempt limit; if a target is not reached, the best candidate wins.

The solver builds a prefix trie once inside a Web Worker, then performs DFS/backtracking from every tile. It tracks visited cells, explores all eight neighbors, and abandons a branch immediately when its prefix is absent from the trie. The completed word set is returned with the board and stored in a `Set` for instant submissions.

## Saved data and accessibility

Sound preference and personal stats are stored in `localStorage`; no account is needed. Menus are keyboard accessible, tiles have descriptive labels, contrast is high, touch uses Pointer Events, and reduced-motion preferences are honored.
