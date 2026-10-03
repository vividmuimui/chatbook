import { atom } from "jotai";

/**
 * Whether the search through the book's text is up.
 *
 * Written by the header's toggle, the toolbar's on one column, the keyboard
 * (vim's `/`) and the panel itself on one column when a result is picked. Not
 * saved anywhere: it is something done while reading, not a way of laying the
 * book out, and the store is thrown away with the book.
 */
export const bookSearchOpenAtom = atom<boolean>(false);

/**
 * What the reader last asked the book's text to be searched for, or "" before
 * they have.
 *
 * Kept out of the panel so folding it away and bringing it back shows the same
 * results, which SWR still holds under the same key.
 */
export const bookSearchTermAtom = atom<string>("");
