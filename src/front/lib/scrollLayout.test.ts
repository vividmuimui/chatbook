import { describe, it, expect } from "vite-plus/test";
import {
  anchorAt,
  pagesInView,
  pagesToDraw,
  readingPage,
  scrollTopOf,
  stackPages,
} from "./scrollLayout";

// Ten pages of 1000px with a 20px gap under each: page N starts at (N-1)*1020
const STACK = stackPages(Array(10).fill(1000), 20);

describe("stackPages", () => {
  it("puts each page under the one before, gap and all", () => {
    const stack = stackPages([100, 300, 200], 10);
    expect(stack.tops).toStrictEqual([0, 110, 420]);
    expect(stack.heights).toStrictEqual([110, 310, 210]);
    expect(stack.total).toBe(630);
  });
});

describe("pagesInView", () => {
  it("is every page any part of which is between the top and the bottom of the view", () => {
    expect(pagesInView(STACK, 0, 700)).toStrictEqual({ first: 1, last: 1 });
    expect(pagesInView(STACK, 900, 700)).toStrictEqual({ first: 1, last: 2 });
    expect(pagesInView(STACK, 1020, 1020)).toStrictEqual({ first: 2, last: 2 });
  });
});

describe("readingPage", () => {
  it("is the page under the line a quarter of the way down", () => {
    expect(readingPage(STACK, 0, 800)).toBe(1);
    // Page 2's top has come up into the view, but only below the line
    expect(readingPage(STACK, 600, 800)).toBe(1);
    expect(readingPage(STACK, 900, 800)).toBe(2);
  });

  it("is the last page once the end of the book is reached, however short it is", () => {
    const stack = stackPages([1000, 1000, 100], 20);
    expect(readingPage(stack, stack.total - 800, 800)).toBe(3);
  });

  it("is the first page of a book with nothing stacked yet", () => {
    expect(readingPage(stackPages([], 20), 0, 800)).toBe(1);
  });
});

describe("anchorAt / scrollTopOf", () => {
  it("holds the view to the same place on its page when the pages change height", () => {
    const anchor = anchorAt(STACK, 1020 * 3 + 510);
    expect(anchor).toStrictEqual({ page: 4, fraction: 0.5 });

    // Every page drawn half as tall again: the same half-way down page 4
    const taller = stackPages(Array(10).fill(1500), 20);
    expect(scrollTopOf(taller, anchor)).toBe(1520 * 3 + 760);
  });

  it("puts the top of a page at the top of the view", () => {
    expect(scrollTopOf(STACK, { page: 7, fraction: 0 })).toBe(1020 * 6);
    expect(scrollTopOf(STACK, { page: 99, fraction: 0 })).toBe(1020 * 9);
  });
});

describe("pagesToDraw", () => {
  it("draws the pages in view and one either side, and no others", () => {
    expect(pagesToDraw({ first: 5, last: 6 }, 300, 1)).toStrictEqual([4, 5, 6, 7]);
  });

  it("stops at either end of the book", () => {
    expect(pagesToDraw({ first: 1, last: 1 }, 12, 1)).toStrictEqual([1, 2]);
    expect(pagesToDraw({ first: 12, last: 12 }, 12, 2)).toStrictEqual([10, 11, 12]);
  });
});
