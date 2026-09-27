/// <reference lib="webworker" />
import { loadDictionary } from "./dictionary";
import { generateBoard } from "./generator";
import { createTrie } from "./trie";
import type { BoardSize } from "./types";

const trie = createTrie(loadDictionary());

self.onmessage = (event: MessageEvent<{ size: BoardSize }>) => {
  self.postMessage(generateBoard(event.data.size, trie));
};

