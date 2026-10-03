import { describe, it, expect } from "vite-plus/test";
import {
  MAX_SCREEN_WIDTH_PX,
  SPREAD_MIN_SCREEN_WIDTH_PX,
  firstIndexAtOrAfter,
  pagedLayout,
  screenCount,
  screenOfX,
  turnEpub,
  turnForSide,
} from "./epubPaging";

describe("pagedLayout", () => {
  it("lays a phone's pane out as one screen as wide as the pane", () => {
    expect(pagedLayout(366)).toStrictEqual({ columns: 1, viewWidth: 366 });
  });

  it("holds one screen to the width a line is still read at", () => {
    expect(pagedLayout(800)).toStrictEqual({ columns: 1, viewWidth: MAX_SCREEN_WIDTH_PX });
  });

  it("puts two screens side by side once the pane holds two at a readable width", () => {
    const pane = SPREAD_MIN_SCREEN_WIDTH_PX * 2;
    expect(pagedLayout(pane)).toStrictEqual({ columns: 2, viewWidth: pane });
  });

  it("holds each of the two screens to the readable width too", () => {
    expect(pagedLayout(2000)).toStrictEqual({ columns: 2, viewWidth: MAX_SCREEN_WIDTH_PX * 2 });
  });

  it("keeps whole pixels, and two screens of the same width", () => {
    expect(pagedLayout(901.7)).toStrictEqual({ columns: 2, viewWidth: 900 });
    expect(pagedLayout(366.6)).toStrictEqual({ columns: 1, viewWidth: 366 });
  });

  it("has nothing to lay out before the pane has been measured", () => {
    expect(pagedLayout(0)).toStrictEqual({ columns: 1, viewWidth: 0 });
  });
});

describe("screenCount", () => {
  // The columns run on past the chapter's box: its scroll width is every column
  // and the gaps between them, short of the margins on the outside of the two
  // at the ends (2 × 20px here).
  it("counts the screens the chapter's columns fill", () => {
    expect(screenCount(400 - 40, { columns: 1, viewWidth: 400 })).toBe(1);
    expect(screenCount(400 * 5 - 40, { columns: 1, viewWidth: 400 })).toBe(5);
  });

  it("counts a spread as one screen, and a last column alone as one more", () => {
    // Five columns of 400px, two to a screen
    expect(screenCount(400 * 5 - 40, { columns: 2, viewWidth: 800 })).toBe(3);
    expect(screenCount(400 * 4 - 40, { columns: 2, viewWidth: 800 })).toBe(2);
  });

  it("is a single screen while there is nothing laid out to count", () => {
    expect(screenCount(0, { columns: 1, viewWidth: 0 })).toBe(1);
    expect(screenCount(0, { columns: 1, viewWidth: 400 })).toBe(1);
  });
});

describe("screenOfX", () => {
  it("finds the screen a point of the chapter is drawn on", () => {
    expect(screenOfX(20, 400)).toBe(0);
    expect(screenOfX(399, 400)).toBe(0);
    expect(screenOfX(420, 400)).toBe(1);
    expect(screenOfX(1650, 400)).toBe(4);
  });

  it("never names a screen before the first", () => {
    expect(screenOfX(-3, 400)).toBe(0);
    expect(screenOfX(100, 0)).toBe(0);
  });
});

describe("turnEpub", () => {
  const CHAPTERS = 3;

  it("turns to the next screen of the chapter", () => {
    expect(turnEpub({ page: 2, screen: 0, count: 4 }, "next", CHAPTERS)).toStrictEqual({
      page: 2,
      screen: 1,
    });
  });

  it("turns from the last screen of a chapter to the first of the next", () => {
    expect(turnEpub({ page: 2, screen: 3, count: 4 }, "next", CHAPTERS)).toStrictEqual({
      page: 3,
      screen: 0,
    });
  });

  it("turns back from the first screen of a chapter to the last of the one before", () => {
    expect(turnEpub({ page: 2, screen: 0, count: 4 }, "prev", CHAPTERS)).toStrictEqual({
      page: 1,
      screen: "last",
    });
  });

  it("turns back a screen within the chapter", () => {
    expect(turnEpub({ page: 2, screen: 2, count: 4 }, "prev", CHAPTERS)).toStrictEqual({
      page: 2,
      screen: 1,
    });
  });

  it("goes nowhere past either end of the book", () => {
    expect(turnEpub({ page: 1, screen: 0, count: 4 }, "prev", CHAPTERS)).toBeNull();
    expect(turnEpub({ page: 3, screen: 3, count: 4 }, "next", CHAPTERS)).toBeNull();
  });
});

describe("turnForSide", () => {
  it("reads the right as on and the left as back in a book that opens to the left", () => {
    expect(turnForSide("right", "ltr")).toBe("next");
    expect(turnForSide("left", "ltr")).toBe("prev");
  });

  it("reads them the other way round in a book that opens to the right", () => {
    expect(turnForSide("right", "rtl")).toBe("prev");
    expect(turnForSide("left", "rtl")).toBe("next");
  });

  it("opens to the left unless told otherwise", () => {
    expect(turnForSide("right")).toBe("next");
  });
});

describe("firstIndexAtOrAfter", () => {
  it("finds the first item at or past a value, the items rising", () => {
    const screens = [0, 0, 0, 1, 1, 2, 2, 2];
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 1)).toBe(3);
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 2)).toBe(5);
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 0)).toBe(0);
  });

  it("is past the end when nothing reaches the value", () => {
    const screens = [0, 0, 1];
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 2)).toBe(3);
  });

  // A character with nothing drawn — the white space between two paragraphs —
  // stands for wherever the next drawn one is.
  it("reads an item with no value as the next one that has one", () => {
    const screens = [0, null, null, 1, null, 2];
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 1)).toBe(1);
    expect(firstIndexAtOrAfter(screens.length, (i) => screens[i], 2)).toBe(4);
  });
});
