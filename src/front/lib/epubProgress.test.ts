import { describe, it, expect } from "vite-plus/test";
import { anchorOffset, bookPercent, epubProgress, mapEpubBook } from "./epubProgress";
import type { EpubChapter } from "./epub";

const chapter = (path: string, body: string): EpubChapter => ({
  path,
  source: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
});

describe("bookPercent", () => {
  it("is the share of the book's text that comes before the place", () => {
    expect(bookPercent([100, 300, 600], 1, 0)).toBe(0);
    expect(bookPercent([100, 300, 600], 2, 0)).toBe(10);
    expect(bookPercent([100, 300, 600], 2, 150)).toBe(25);
    expect(bookPercent([100, 300, 600], 3, 600)).toBe(100);
  });

  it("rounds down, so the end of the book is the only 100", () => {
    expect(bookPercent([1000], 1, 999)).toBe(99);
  });

  it("holds a place outside the book to it", () => {
    expect(bookPercent([100, 100], 5, 0)).toBe(50);
    expect(bookPercent([100, 100], 1, 500)).toBe(50);
    expect(bookPercent([], 1, 0)).toBe(0);
  });
});

describe("anchorOffset", () => {
  it("counts the text before the element the book gave the id", () => {
    const root = document.createElement("div");
    root.innerHTML = `<h1>七章</h1><p>前置き</p><h2 id="epub-s2">7.2 節</h2><p>本文</p>`;
    expect(anchorOffset(root, "s2")).toBe("七章前置き".length);
    expect(anchorOffset(root, "nowhere")).toBeNull();
  });
});

describe("mapEpubBook", () => {
  const chapters = [
    chapter("OEBPS/ch1.xhtml", "<h1>一章</h1><p>はじめ</p>"),
    chapter(
      "OEBPS/ch7.xhtml",
      `<h1>七章</h1><p>前置き</p><h2 id="s1">7.1 SAML</h2><p>本文一</p><h2 id="s2">7.2 OAuth</h2><p>本文二</p>`,
    ),
  ];
  const outline = [
    { title: "一章", pageNumber: 1, children: [] },
    {
      title: "七章",
      pageNumber: 2,
      children: [
        { title: "7.1 SAML", pageNumber: 2, children: [], anchor: "s1" },
        { title: "7.2 OAuth", pageNumber: 2, children: [], anchor: "s2" },
        { title: "7.9 無い節", pageNumber: 2, children: [], anchor: "missing" },
      ],
    },
  ];

  it("places each entry where its anchor is in the chapter's text", () => {
    const map = mapEpubBook(chapters, outline);

    expect(map.chapterLengths).toStrictEqual([
      "一章はじめ".length,
      "七章前置き7.1 SAML本文一7.2 OAuth本文二".length,
    ]);
    const [saml, oauth, missing] = map.outline[1].children;
    expect(saml.offset).toBe("七章前置き".length);
    expect(oauth.offset).toBe("七章前置き7.1 SAML本文一".length);
    // An anchor the chapter does not have is placed after the entries before
    // it — here at the chapter's end — rather than at the top, where it would
    // count as reached all through the chapter
    expect(missing.offset).toBe(map.chapterLengths[1]);
  });

  it("names the section the reader is in, and how far into the book that is", () => {
    const map = mapEpubBook(chapters, outline);
    const total = map.chapterLengths[0] + map.chapterLengths[1];

    expect(epubProgress(map, 2, 0)).toStrictEqual({
      percent: Math.floor((map.chapterLengths[0] / total) * 100),
      section: "七章",
    });
    expect(epubProgress(map, 2, "七章前置き7.1 SAML本文一7.2".length).section).toBe("7.2 OAuth");
    expect(epubProgress(map, 1, 0).section).toBe("一章");
  });
});
