import { describe, it, expect } from "vite-plus/test";
import { extractEpubData } from "./epubLoader";
import { isEpubFile } from "./bookLoader";
import { buildEpub } from "../../test/epubFixture";

const epubFile = (bytes: Uint8Array, name = "本.epub") =>
  new File([bytes as BlobPart], name, { type: "application/epub+zip" });

describe("extractEpubData", () => {
  it("stores each chapter as a page, joined the way a PDF's pages are", async () => {
    const extracted = await extractEpubData(
      epubFile(
        buildEpub({
          chapters: [
            { file: "ch1.xhtml", body: "<h1>第1章</h1><p>エッジで動く。</p>" },
            { file: "ch2.xhtml", body: "<h1>第2章</h1><p>永続化する。</p>" },
          ],
          nav: '<ol><li><a href="ch1.xhtml">第1章</a></li><li><a href="ch2.xhtml">第2章</a></li></ol>',
        }),
      ),
    );

    expect(extracted.fileName).toBe("本.epub");
    expect(extracted.pageCount).toBe(2);
    expect(extracted.fullText).toBe("第1章\nエッジで動く。\f第2章\n永続化する。");
    expect(extracted.outline).toStrictEqual([
      { title: "第1章", pageNumber: 1 },
      { title: "第2章", pageNumber: 2 },
    ]);
    expect(extracted.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the book without an outline when it has no table of contents", async () => {
    const extracted = await extractEpubData(
      epubFile(buildEpub({ chapters: [{ file: "ch1.xhtml", body: "<p>本文</p>" }] })),
    );

    expect(extracted.outline).toBeNull();
  });

  it("refuses a book with no text in any chapter, rather than storing a blank one", async () => {
    await expect(
      extractEpubData(epubFile(buildEpub({ chapters: [{ file: "c.xhtml", body: "<p> </p>" }] }))),
    ).rejects.toThrow("EPUBに本文がありません");
  });
});

describe("isEpubFile", () => {
  it("reads the format off the bytes rather than the name", async () => {
    const epub = buildEpub({ chapters: [{ file: "c.xhtml", body: "<p>本文</p>" }] });

    expect(await isEpubFile(epubFile(epub, "misnamed.pdf"))).toBe(true);
    expect(await isEpubFile(new File(["%PDF-1.7"], "misnamed.epub"))).toBe(false);
  });
});
