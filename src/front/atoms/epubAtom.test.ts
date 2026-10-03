import { describe, it, expect } from "vite-plus/test";
import { createStore } from "jotai";
import { epubScreenAtom, shownScreen, turnEpubAtom } from "./epubAtom";
import { currentPageAtom } from "./pdfAtom";

const CHAPTERS = 3;

function storeAt(page: number, screen: number | "last", count: number, laidOutFor = page) {
  const store = createStore();
  store.set(currentPageAtom, page);
  store.set(epubScreenAtom, { page: laidOutFor, screen, count });
  return store;
}

describe("shownScreen", () => {
  it("shows the first screen of a chapter that has not been laid out yet", () => {
    expect(shownScreen({ page: 1, screen: 4, count: 6 }, 2)).toStrictEqual({ screen: 0, count: 1 });
  });

  it("shows the last screen it was asked for, and no screen past the chapter's end", () => {
    expect(shownScreen({ page: 2, screen: "last", count: 6 }, 2)).toStrictEqual({
      screen: 5,
      count: 6,
    });
    expect(shownScreen({ page: 2, screen: 9, count: 6 }, 2)).toStrictEqual({
      screen: 5,
      count: 6,
    });
  });
});

describe("turnEpubAtom", () => {
  it("turns a screen on within the chapter, leaving the chapter be", () => {
    const store = storeAt(2, 1, 4);

    store.set(turnEpubAtom, { turn: "next", pageCount: CHAPTERS });

    expect(store.get(currentPageAtom)).toBe(2);
    expect(store.get(epubScreenAtom)).toStrictEqual({ page: 2, screen: 2, count: 4 });
  });

  it("turns from the end of a chapter into the start of the next", () => {
    const store = storeAt(2, 3, 4);

    store.set(turnEpubAtom, { turn: "next", pageCount: CHAPTERS });

    expect(store.get(currentPageAtom)).toBe(3);
    expect(store.get(epubScreenAtom)).toMatchObject({ page: 3, screen: 0 });
  });

  it("turns back from the start of a chapter into the end of the one before", () => {
    const store = storeAt(2, 0, 4);

    store.set(turnEpubAtom, { turn: "prev", pageCount: CHAPTERS });

    expect(store.get(currentPageAtom)).toBe(1);
    expect(store.get(epubScreenAtom)).toMatchObject({ page: 1, screen: "last" });
  });

  // The outline, a citation or the address moved the reader without a turn:
  // the screen still names the chapter they were on before.
  it("turns from the first screen of a chapter the reader was taken to some other way", () => {
    const store = storeAt(3, 5, 8, 1);

    store.set(turnEpubAtom, { turn: "prev", pageCount: CHAPTERS });

    expect(store.get(currentPageAtom)).toBe(2);
    expect(store.get(epubScreenAtom)).toMatchObject({ page: 2, screen: "last" });
  });

  it("stays put past either end of the book", () => {
    const store = storeAt(CHAPTERS, 3, 4);

    store.set(turnEpubAtom, { turn: "next", pageCount: CHAPTERS });

    expect(store.get(currentPageAtom)).toBe(CHAPTERS);
    expect(store.get(epubScreenAtom)).toStrictEqual({ page: CHAPTERS, screen: 3, count: 4 });
  });
});
