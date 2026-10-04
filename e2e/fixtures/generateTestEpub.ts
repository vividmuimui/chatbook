/**
 * Builds `test-epub.epub`, the EPUB the E2E suite uploads.
 *
 * Run it after changing `testEpubManifest.ts`; the EPUB itself is committed:
 *
 *     node --experimental-strip-types e2e/fixtures/generateTestEpub.ts
 *
 * Every entry carries the same fixed date, so a re-run leaves no diff unless
 * the manifest changed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  EPUB_CHAPTERS,
  EPUB_FILE_NAME,
  LINKED_ANCHOR,
  chapterParagraphs,
} from "./testEpubManifest.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MTIME = new Date(Date.UTC(2026, 0, 1));

const page = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
<head><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
<body>
${body}
</body>
</html>`;

const chapters = EPUB_CHAPTERS.map((chapter, i) => {
  const isLast = i === EPUB_CHAPTERS.length - 1;
  const lastParagraph = chapterParagraphs(chapter).length - 1;
  let index = 0;
  const paragraph = (text: string) => {
    // The last paragraph of the last chapter is what chapter 1 links to
    const id = isLast && index++ === lastParagraph;
    return `<p${id ? ` id="${LINKED_ANCHOR}"` : ""}>${text}</p>`;
  };
  const body = [
    `<h1>${chapter.heading}</h1>`,
    ...chapter.paragraphs.map(paragraph),
    ...(chapter.sections ?? []).flatMap((section) => [
      `<h2 id="${section.id}">${section.heading}</h2>`,
      ...section.paragraphs.map(paragraph),
    ]),
  ];
  if (i === 0) {
    body.push(
      `<p><a href="${EPUB_CHAPTERS[EPUB_CHAPTERS.length - 1].file}#${LINKED_ANCHOR}">R2 について</a></p>`,
    );
  }
  return { file: chapter.file, xhtml: page(chapter.heading, body.join("\n")) };
});

const nav = page(
  "目次",
  `<nav epub:type="toc"><h1>目次</h1><ol>
${EPUB_CHAPTERS.map((chapter) => {
  const sections = (chapter.sections ?? [])
    .map((section) => `<li><a href="${chapter.file}#${section.id}">${section.heading}</a></li>`)
    .join("");
  return `<li><a href="${chapter.file}">${chapter.heading}</a>${sections ? `<ol>${sections}</ol>` : ""}</li>`;
}).join("\n")}
</ol></nav>`,
);

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
    <dc:title>テスト用の本</dc:title>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `    <item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine>
${chapters.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join("\n")}
  </spine>
</package>`;

const files: Zippable = {
  // First and stored, as the EPUB container format asks
  mimetype: [strToU8("application/epub+zip"), { level: 0, mtime: MTIME }],
  "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  "OEBPS/content.opf": strToU8(opf),
  "OEBPS/nav.xhtml": strToU8(nav),
  // Never drawn: the reader uses its own type, and the test checks it does
  "OEBPS/style.css": strToU8("body { color: rgb(255, 0, 0); }"),
};
for (const chapter of chapters) files[`OEBPS/${chapter.file}`] = strToU8(chapter.xhtml);

fs.writeFileSync(path.join(here, EPUB_FILE_NAME), zipSync(files, { mtime: MTIME }));
console.log(`Wrote ${EPUB_FILE_NAME}`);
