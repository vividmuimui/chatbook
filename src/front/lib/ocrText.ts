import type { OcrLine } from "../../shared/schemas/ocr";

/**
 * Fewer non-blank characters than this and a page counts as having no text.
 *
 * Not zero: a scanned book often carries a page number, or a stray glyph a
 * scanner's own OCR left behind, and a page of nothing but "12" is still a page
 * the reader cannot select or search.
 */
export const MIN_PAGE_TEXT_CHARS = 8;

const nonBlankLength = (text: string) => text.replace(/\s/g, "").length;

/**
 * The pages to read by OCR, numbered from 1 — or none at all.
 *
 * Only a book that is mostly without text is read: one where more than half
 * the pages fall short. A typeset book with a few figure pages has nothing on
 * those pages a reader would select, and reading them would hold the upload up
 * for the length of an OCR run. When a book does qualify, only its pages
 * without text are read; a page pdf.js can read keeps its own text.
 */
export function pagesNeedingOcr(pageTexts: string[]): number[] {
  const blank = pageTexts.flatMap((text, index) =>
    nonBlankLength(text) < MIN_PAGE_TEXT_CHARS ? [index + 1] : [],
  );
  return blank.length * 2 > pageTexts.length ? blank : [];
}

/**
 * Characters written without spaces between them: kanji, kana, and the
 * full-width marks set among them.
 */
const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯ー`;
const SPACE_BESIDE_CJK = new RegExp(`(?<=[${CJK}]) +| +(?=[${CJK}])`, "gu");

/**
 * One recognised line as text a reader would have typed.
 *
 * Tesseract puts a space between every two Japanese characters it reads. Left
 * in, a reader's search for 日本語 would still land (the search drops spaces),
 * but a passage quoted to the chat and the text copied off the page would read
 * 日 本 語. Spaces between words that are not Japanese are kept, one each.
 */
export function normalizeOcrLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(SPACE_BESIDE_CJK, "");
}

/** A line as Tesseract reports it, in pixels of the image it was given. */
export interface RecognizedLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Recognised lines brought back from the enlarged render they were read off to
 * the page's own units, ready to be stored. A line that reads as nothing, or a
 * box with no height, would only be an empty span on the page, so neither is
 * kept.
 */
export function toOcrLines(lines: RecognizedLine[], scale: number): OcrLine[] {
  return lines.flatMap(({ text, bbox }) => {
    const normalized = normalizeOcrLine(text);
    const height = (bbox.y1 - bbox.y0) / scale;
    if (!normalized || height <= 0) return [];
    return [
      {
        text: normalized,
        x: bbox.x0 / scale,
        y: bbox.y0 / scale,
        width: Math.max(0, (bbox.x1 - bbox.x0) / scale),
        height,
      },
    ];
  });
}

/** A page's text for `fullText`: its lines in reading order, one per row. */
export function ocrPageText(lines: OcrLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

/** The font name the OCR lines are filed under in the text content's styles. */
export const OCR_FONT_NAME = "chatbook-ocr";

/**
 * How far above the baseline the top of a line sits, as a share of its height.
 *
 * The text layer puts a span's top at `baseline - ascent × height`, where the
 * ascent is what it measures off the font. It is only known there, so the
 * baseline is placed with pdf.js' own fallback for it; sans-serif measures
 * close to this, and the error is a sliver of the line's height.
 */
export const OCR_ASCENT = 0.8;

/** pdf.js' text content, in the parts the text layer reads. */
export interface OcrTextContent {
  items: {
    str: string;
    dir: string;
    transform: number[];
    width: number;
    height: number;
    fontName: string;
    hasEOL: boolean;
  }[];
  styles: Record<
    string,
    { fontFamily: string; ascent: number; descent: number; vertical: boolean }
  >;
  lang: string | null;
}

/** `m1 ∘ m2` for pdf.js' 6-number affine transforms (m2 applies first). */
function compose(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function invert([a, b, c, d, e, f]: number[]): number[] {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * OCR lines dressed as the text content pdf.js would have read off the page,
 * so pdf.js' own `TextLayer` lays them out.
 *
 * Going through the text layer rather than placing spans by hand keeps
 * everything that reads the page working unchanged: the CSS contract of
 * `.textLayer` (`--font-height` and `--scale-x`), the page numbers stamped on
 * the spans, the selection guard, and the matchers that find a quote in them.
 *
 * Each line is set in the page's own space — the text layer works there, and
 * turns the page itself for `/Rotate` — by undoing the scale-1 viewport the
 * box was measured in. The width is the box's: the text layer stretches the
 * span to it, so a selection covers what was read rather than what the
 * stand-in font happens to measure.
 */
export function ocrTextContent(lines: OcrLine[], viewportTransform: number[]): OcrTextContent {
  const toPage = invert(viewportTransform);
  return {
    items: lines.map(({ text, x, y, width, height }) => ({
      str: text,
      dir: "ltr",
      // Upright in the viewport, as tall as the box, on a baseline that puts
      // the span's top at the top of the box
      transform: compose(toPage, [height, 0, 0, -height, x, y + OCR_ASCENT * height]),
      width,
      height,
      fontName: OCR_FONT_NAME,
      hasEOL: true,
    })),
    styles: {
      [OCR_FONT_NAME]: {
        fontFamily: "sans-serif",
        ascent: OCR_ASCENT,
        descent: OCR_ASCENT - 1,
        vertical: false,
      },
    },
    lang: null,
  };
}
