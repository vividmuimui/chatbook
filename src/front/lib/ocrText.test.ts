import { describe, expect, it } from "vitest";
import {
  OCR_ASCENT,
  OCR_FONT_NAME,
  normalizeOcrLine,
  ocrPageText,
  ocrTextContent,
  pagesNeedingOcr,
  toOcrLines,
} from "./ocrText";

describe("pagesNeedingOcr", () => {
  it("reads nothing again in a book whose pages carry their own text", () => {
    expect(pagesNeedingOcr(["Chapter one begins here", "and goes on for a while"])).toStrictEqual(
      [],
    );
  });

  it("reads every page of a book with no text at all", () => {
    expect(pagesNeedingOcr(["", "", ""])).toStrictEqual([1, 2, 3]);
  });

  it("takes a page holding only a stamped page number for one without text", () => {
    expect(pagesNeedingOcr(["12", " 13 ", "", "Some real text on this one"])).toStrictEqual([
      1, 2, 3,
    ]);
  });

  it("leaves a text book with a few picture pages alone", () => {
    // A figure page in an otherwise typeset book is not worth minutes of OCR
    expect(
      pagesNeedingOcr(["Plenty of text here", "", "More text on this page", "And again here"]),
    ).toStrictEqual([]);
  });

  it("does not count whitespace as text", () => {
    expect(pagesNeedingOcr(["   \n\t   \n  ", "a b c d"])).toStrictEqual([1, 2]);
  });

  it("reads nothing in a book with no pages", () => {
    expect(pagesNeedingOcr([])).toStrictEqual([]);
  });
});

describe("normalizeOcrLine", () => {
  it("closes the gaps OCR leaves between Japanese characters", () => {
    expect(normalizeOcrLine("日 本 語 の 本 。")).toBe("日本語の本。");
  });

  it("keeps the spaces between English words, one each", () => {
    expect(normalizeOcrLine("  the   brass  lantern ")).toBe("the brass lantern");
  });

  it("closes a gap between Japanese and a fullwidth mark but not between words", () => {
    expect(normalizeOcrLine("灯 台 （ 二 ） は Lighthouse keeper")).toBe(
      "灯台（二）はLighthouse keeper",
    );
  });
});

describe("toOcrLines", () => {
  it("brings boxes measured on the enlarged render back to page units", () => {
    expect(
      toOcrLines([{ text: "the brass lantern", bbox: { x0: 100, y0: 200, x1: 500, y1: 240 } }], 2),
    ).toStrictEqual([{ text: "the brass lantern", x: 50, y: 100, width: 200, height: 20 }]);
  });

  it("drops lines that read as nothing and boxes with no height", () => {
    expect(
      toOcrLines(
        [
          { text: "  \n", bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
          { text: "flat", bbox: { x0: 0, y0: 5, x1: 10, y1: 5 } },
          { text: "日 本\n", bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } },
        ],
        1,
      ),
    ).toStrictEqual([{ text: "日本", x: 0, y: 0, width: 20, height: 10 }]);
  });
});

describe("ocrPageText", () => {
  it("puts the page's lines one under another", () => {
    expect(
      ocrPageText([
        { text: "first", x: 0, y: 0, width: 1, height: 1 },
        { text: "second", x: 0, y: 2, width: 1, height: 1 },
      ]),
    ).toBe("first\nsecond");
  });
});

describe("ocrTextContent", () => {
  /** pdf.js' viewport transform for an upright page of the given height at scale 1. */
  const upright = (height: number) => [1, 0, 0, -1, 0, height];

  /** What the text layer computes for an item: the flip to the top-left origin. */
  const onPage = (transform: number[], height: number) => {
    const [a, b, c, d, e, f] = transform;
    // `+ 0` folds the -0 a negated zero leaves, which toEqual tells apart
    return [a, -b, c, -d, e, height - f].map((v) => v + 0);
  };

  it("lays a line over the place it was read from, as pdf.js lays its own", () => {
    const content = ocrTextContent(
      [{ text: "lantern", x: 72, y: 100, width: 120, height: 20 }],
      upright(842),
    );
    expect(content.items).toHaveLength(1);
    const [item] = content.items;
    expect(item).toMatchObject({
      str: "lantern",
      width: 120,
      height: 20,
      fontName: OCR_FONT_NAME,
      dir: "ltr",
      hasEOL: true,
    });

    // In the text layer's own space the line is upright, as tall as its box,
    // and its top — the baseline less the ascent — is the top of the box.
    const [a, b, c, d, left, baseline] = onPage(item.transform, 842);
    expect([a, b, c, d]).toStrictEqual([20, 0, 0, -20]);
    expect(left).toBeCloseTo(72);
    expect(baseline - OCR_ASCENT * 20).toBeCloseTo(100);
  });

  it("turns a line on a rotated page back into the page's own space", () => {
    // A page with /Rotate 90: pdf.js' viewport maps (x, y) to (y, x)
    const rotated = [0, 1, 1, 0, 0, 0];
    const [item] = ocrTextContent(
      [{ text: "side", x: 10, y: 30, width: 50, height: 10 }],
      rotated,
    ).items;
    // Applying the viewport again lands the line where it was read
    const [a, b, c, d, e, f] = rotated;
    const [p, q, r, s, t, u] = item.transform;
    expect([a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s]).toStrictEqual([
      10, 0, 0, -10,
    ]);
    expect(a * t + c * u + e).toBeCloseTo(10);
    expect(b * t + d * u + f).toBeCloseTo(30 + OCR_ASCENT * 10);
  });

  it("names a style the text layer can draw the lines in", () => {
    const content = ocrTextContent([], upright(100));
    expect(content.items).toStrictEqual([]);
    expect(content.styles[OCR_FONT_NAME]).toMatchObject({
      fontFamily: "sans-serif",
      vertical: false,
      ascent: OCR_ASCENT,
    });
  });
});
