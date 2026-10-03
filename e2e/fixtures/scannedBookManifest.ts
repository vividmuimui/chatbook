/**
 * What `scanned-book.pdf` says, page by page — the book with no text layer
 * that has to be read by OCR before it can be added.
 *
 * Every page is a picture of its lines and nothing else, so pdf.js reads no
 * text off it at all. The lines are short, set large and in English, because
 * the test searches for words the OCR has to have read exactly; one Japanese
 * line per page is there for the Japanese model to read, and nothing depends on
 * it being read letter for letter.
 */
export const SCANNED_FIXTURE_FILE_NAME = "scanned-book.pdf";

export const SCANNED_PAGES: string[][] = [
  ["Lighthouse Keeper Log", "灯台守の日誌", "Fog rolled in from the cape."],
  ["The brass lantern was polished.", "灯りは夜通し灯された", "Ships passed safely by dawn."],
];

/** The word the E2E search looks for, and the page it is only on. */
export const SCANNED_SEARCH_WORD = "lantern";
export const SCANNED_SEARCH_PAGE = 2;
