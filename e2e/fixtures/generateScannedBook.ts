/**
 * Draws `scanned-book.pdf`, a book whose pages are pictures of text — what a
 * scanner produces — so the suite can add a book that has to be read by OCR.
 *
 *     node e2e/fixtures/generateScannedBook.ts
 *
 * Each page's lines are set as HTML and photographed by the Chromium the E2E
 * suite already installs, and the PNG is the whole of the PDF page: no text
 * operator is written, so pdf.js reads nothing off it, exactly as with a scan.
 * The glyphs come from the machine's own fonts (a Japanese one is needed for
 * the Japanese lines), so a re-run elsewhere may differ in its pixels — the PDF
 * is committed, and nothing reads it but OCR.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { chromium } from "@playwright/test";
import { SCANNED_FIXTURE_FILE_NAME, SCANNED_PAGES } from "./scannedBookManifest.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(here, SCANNED_FIXTURE_FILE_NAME);

/** A fixed date, so the file ID and the XMP metadata do not change per run. */
const CREATED_AT = new Date(Date.UTC(2026, 0, 1));

/** A4 at 150 dpi: about what a book scanner is set to for text. */
const IMAGE_WIDTH = 1240;
const IMAGE_HEIGHT = 1754;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

/** Black on white and nothing else, as a clean scan of a printed page is. */
function pageHtml(lines: string[]): string {
  const escaped = lines.map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  return `<!doctype html><html><body style="margin:0;background:#fff;color:#000;
    font-family:'Hiragino Sans','Noto Sans CJK JP',sans-serif;font-size:44px;line-height:1.2">
    <div style="padding:160px 140px">${escaped
      .map((line) => `<p style="margin:0 0 56px">${line}</p>`)
      .join("")}</div></body></html>`;
}

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT } });
const images: Buffer[] = [];
for (const lines of SCANNED_PAGES) {
  await tab.setContent(pageHtml(lines));
  images.push(await tab.screenshot({ type: "png" }));
}
await browser.close();

// The creation date goes through the constructor because pdfkit derives the
// file ID from `info` there; setting it afterwards leaves the ID random.
const doc = new PDFDocument({
  size: "A4",
  margin: 0,
  autoFirstPage: false,
  info: { CreationDate: CREATED_AT },
});

const written = new Promise<void>((resolve, reject) => {
  const stream = fs.createWriteStream(OUTPUT);
  stream.on("finish", () => resolve());
  stream.on("error", reject);
  doc.pipe(stream);
});

for (const image of images) {
  doc.addPage();
  doc.image(image, 0, 0, { width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
}

doc.end();
await written;
console.log(`${OUTPUT} (${images.length} pages, ${fs.statSync(OUTPUT).size} bytes)`);
