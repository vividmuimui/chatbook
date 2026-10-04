import { describe, it, expect } from "vite-plus/test";
import { strToU8, zipSync } from "fflate";
import { EpubError, fragmentOf, openEpub, resolveArchivePath } from "./epub";
import { buildEpub } from "../../test/epubFixture";

describe("resolveArchivePath", () => {
  it("resolves a reference against the directory of the file it is written in", () => {
    expect(resolveArchivePath("OEBPS/text/ch1.xhtml", "ch2.xhtml#sec")).toBe(
      "OEBPS/text/ch2.xhtml",
    );
  });

  it("climbs out of a directory with ..", () => {
    expect(resolveArchivePath("OEBPS/text/ch1.xhtml", "../images/fig%201.png")).toBe(
      "OEBPS/images/fig 1.png",
    );
  });

  it("reads a leading slash from the root of the archive", () => {
    expect(resolveArchivePath("OEBPS/text/ch1.xhtml", "/OEBPS/a.xhtml")).toBe("OEBPS/a.xhtml");
  });
});

describe("fragmentOf", () => {
  it("returns the decoded fragment, or null when there is none", () => {
    expect(fragmentOf("ch1.xhtml#%E7%AF%80")).toBe("節");
    expect(fragmentOf("ch1.xhtml")).toBeNull();
    expect(fragmentOf("ch1.xhtml#")).toBeNull();
  });
});

describe("openEpub", () => {
  it("lists the chapters in reading order, leaving out what the publisher kept out of it", () => {
    const book = openEpub(
      buildEpub({
        chapters: [
          { file: "b.xhtml", body: "<p>一</p>" },
          { file: "notes.xhtml", body: "<p>注</p>", linear: false },
          { file: "a.xhtml", body: "<p>二</p>" },
        ],
      }),
    );

    expect(book.title).toBe("テストの本");
    expect(book.chapters.map((chapter) => chapter.path)).toStrictEqual([
      "OEBPS/b.xhtml",
      "OEBPS/a.xhtml",
    ]);
    expect(book.chapters[0].source).toContain("<p>一</p>");
  });

  it("resolves the EPUB 3 table of contents to the chapter each entry opens", () => {
    const book = openEpub(
      buildEpub({
        chapters: [
          { file: "ch1.xhtml", body: "<h1>第1章</h1>" },
          { file: "ch2.xhtml", body: "<h1>第2章</h1>" },
        ],
        nav: `<ol>
          <li><a href="ch1.xhtml">第1章 はじめに</a>
            <ol><li><a href="ch2.xhtml#s1">1.1 節</a></li></ol>
          </li>
          <li><span>付録</span></li>
          <li><a href="https://example.com">外部</a></li>
        </ol>`,
      }),
    );

    expect(book.outline).toStrictEqual([
      {
        title: "第1章 はじめに",
        pageNumber: 1,
        children: [{ title: "1.1 節", pageNumber: 2, children: [], anchor: "s1" }],
      },
      { title: "付録", pageNumber: null, children: [] },
      { title: "外部", pageNumber: null, children: [] },
    ]);
  });

  it("falls back to the EPUB 2 NCX when there is no navigation document", () => {
    const book = openEpub(
      buildEpub({
        chapters: [
          { file: "ch1.xhtml", body: "<p>一</p>" },
          { file: "ch2.xhtml", body: "<p>二</p>" },
        ],
        ncx: `<navPoint id="n1"><navLabel><text>一章</text></navLabel><content src="ch1.xhtml"/>
            <navPoint id="n2"><navLabel><text>二章</text></navLabel><content src="ch2.xhtml#x"/></navPoint>
          </navPoint>`,
      }),
    );

    expect(book.outline).toStrictEqual([
      {
        title: "一章",
        pageNumber: 1,
        children: [{ title: "二章", pageNumber: 2, children: [], anchor: "x" }],
      },
    ]);
  });

  it("finds the cover image the manifest names", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const book = openEpub(
      buildEpub({
        chapters: [{ file: "ch1.xhtml", body: "<p>一</p>" }],
        resources: [
          { file: "cover.png", mediaType: "image/png", bytes: png, properties: "cover-image" },
        ],
      }),
    );

    expect(book.coverPath).toBe("OEBPS/cover.png");
    expect(book.file("OEBPS/cover.png")).toStrictEqual(png);
    expect(book.mediaType("OEBPS/cover.png")).toBe("image/png");
  });

  it("refuses an archive that is not an EPUB", () => {
    const notAnEpub = zipSync({ "readme.txt": strToU8("hello") });

    expect(() => openEpub(notAnEpub)).toThrow(EpubError);
  });

  it("refuses bytes that are not an archive at all", () => {
    expect(() => openEpub(strToU8("%PDF-1.7"))).toThrow(EpubError);
  });

  it("refuses a book with no chapter to read", () => {
    expect(() =>
      openEpub(buildEpub({ chapters: [{ file: "n.xhtml", body: "", linear: false }] })),
    ).toThrow("EPUBに読める章がありません");
  });
});
