import type { TrieNode } from "./trie";

export function areAdjacent(a: number, b: number, size: number) {
  const ar = Math.floor(a / size);
  const ac = a % size;
  const br = Math.floor(b / size);
  const bc = b % size;
  return a !== b && Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
}

export function validatePath(path: number[], size: number) {
  if (new Set(path).size !== path.length) return false;
  return path.every((index, position) =>
    index >= 0 && index < size * size && (position === 0 || areAdjacent(path[position - 1]!, index, size)),
  );
}

export function solveBoard(board: string[], size: number, trie: TrieNode) {
  const found = new Set<string>();
  const visited = new Uint8Array(board.length);

  function visit(index: number, node: TrieNode, word: string) {
    const next = node.children.get(board[index]!.toLowerCase());
    if (!next) return;
    const candidate = word + board[index]!.toLowerCase();
    if (next.word && candidate.length >= 3) found.add(candidate);
    visited[index] = 1;
    const row = Math.floor(index / size);
    const col = index % size;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
        const nextIndex = nr * size + nc;
        if (!visited[nextIndex]) visit(nextIndex, next, candidate);
      }
    }
    visited[index] = 0;
  }

  board.forEach((_, index) => visit(index, trie, ""));
  return found;
}

