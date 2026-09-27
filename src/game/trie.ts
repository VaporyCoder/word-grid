export type TrieNode = {
  children: Map<string, TrieNode>;
  word: boolean;
};

export function createTrie(words: Iterable<string>): TrieNode {
  const root: TrieNode = { children: new Map(), word: false };
  for (const rawWord of words) {
    const word = rawWord.toLowerCase();
    let node = root;
    for (const letter of word) {
      let next = node.children.get(letter);
      if (!next) {
        next = { children: new Map(), word: false };
        node.children.set(letter, next);
      }
      node = next;
    }
    node.word = true;
  }
  return root;
}

