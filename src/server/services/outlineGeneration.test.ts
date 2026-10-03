import { describe, it, expect } from "vite-plus/test";
import {
  OUTLINE_PAGE_HEAD_CHARS,
  OUTLINE_PROMPT_BUDGET_CHARS,
  buildOutlineMessages,
  pageHeads,
  readGeneratedOutline,
} from "./outlineGeneration";
import { MAX_OUTLINE_CHAPTERS, MAX_OUTLINE_TITLE_LENGTH } from "../../shared/schemas/book";

describe("pageHeads", () => {
  it("numbers the head of each page the way the book numbers its pages", () => {
    expect(pageHeads("表紙\f第1章 はじめに\n本文\f第2章")).toBe(
      "p.1: 表紙\np.2: 第1章 はじめに 本文\np.3: 第2章",
    );
  });

  it("keeps only the head of a long page", () => {
    const long = "あ".repeat(OUTLINE_PAGE_HEAD_CHARS + 50);

    expect(pageHeads(long)).toBe(`p.1: ${"あ".repeat(OUTLINE_PAGE_HEAD_CHARS)}`);
  });

  it("leaves out pages with nothing on them, keeping the numbers of the rest", () => {
    expect(pageHeads("一\f   \n \f三")).toBe("p.1: 一\np.3: 三");
  });

  it("gives each page less of itself in a book too long to show every head in full", () => {
    const pageCount = 1000;
    const book = Array.from({ length: pageCount }, () => "字".repeat(500)).join("\f");

    const heads = pageHeads(book);

    expect(heads.length).toBeLessThanOrEqual(OUTLINE_PROMPT_BUDGET_CHARS + pageCount * 12);
    expect(heads.split("\n")).toHaveLength(pageCount);
  });
});

describe("buildOutlineMessages", () => {
  it("asks for JSON chapters with their start page, and hands over the heads of the pages", () => {
    const [system, user] = buildOutlineMessages("表紙\f第1章", 2);

    expect(system.role).toBe("system");
    expect(system.content).toContain('"chapters"');
    expect(system.content).toContain('"page"');
    expect(user.role).toBe("user");
    expect(user.content).toContain("2 pages");
    expect(user.content).toContain("p.2: 第1章");
  });
});

describe("readGeneratedOutline", () => {
  it("reads the chapters out of a plain JSON answer", () => {
    expect(readGeneratedOutline('{"chapters":[{"title":"第1章","page":3}]}', 10)).toStrictEqual([
      { title: "第1章", pageNumber: 3 },
    ]);
  });

  it("reads an answer wrapped in a code fence, or with words around it", () => {
    expect(
      readGeneratedOutline(
        '目次はこちらです。\n```json\n{"chapters":[{"title":"序章","page":1}]}\n```\n以上です。',
        10,
      ),
    ).toStrictEqual([{ title: "序章", pageNumber: 1 }]);
  });

  it("accepts a bare array of chapters", () => {
    expect(readGeneratedOutline('[{"title":"序章","page":2}]', 10)).toStrictEqual([
      { title: "序章", pageNumber: 2 },
    ]);
  });

  it("puts the chapters in page order and keeps one per page", () => {
    expect(
      readGeneratedOutline(
        JSON.stringify({
          chapters: [
            { title: "第2章", page: 8 },
            { title: "第1章", page: 3 },
            { title: "第1章（重複）", page: 3 },
          ],
        }),
        10,
      ),
    ).toStrictEqual([
      { title: "第1章", pageNumber: 3 },
      { title: "第2章", pageNumber: 8 },
    ]);
  });

  it("brings pages outside the book back inside it", () => {
    expect(
      readGeneratedOutline(
        JSON.stringify({
          chapters: [
            { title: "前", page: 0 },
            { title: "後", page: 99 },
            { title: "中", page: 4.6 },
          ],
        }),
        10,
      ),
    ).toStrictEqual([
      { title: "前", pageNumber: 1 },
      { title: "中", pageNumber: 5 },
      { title: "後", pageNumber: 10 },
    ]);
  });

  it("drops chapters without a title, and trims and clamps the titles", () => {
    expect(
      readGeneratedOutline(
        JSON.stringify({
          chapters: [
            { title: "   ", page: 2 },
            { title: "  第1章  ", page: 3 },
            { title: "長".repeat(MAX_OUTLINE_TITLE_LENGTH + 10), page: 4 },
          ],
        }),
        10,
      ),
    ).toStrictEqual([
      { title: "第1章", pageNumber: 3 },
      { title: "長".repeat(MAX_OUTLINE_TITLE_LENGTH), pageNumber: 4 },
    ]);
  });

  it("keeps no more chapters than the server stores", () => {
    const chapters = Array.from({ length: MAX_OUTLINE_CHAPTERS + 5 }, (_, i) => ({
      title: `章${i}`,
      page: i + 1,
    }));

    expect(readGeneratedOutline(JSON.stringify({ chapters }), 5000)).toHaveLength(
      MAX_OUTLINE_CHAPTERS,
    );
  });

  it.each([
    ["words with no JSON in them", "わかりません"],
    ["JSON that is broken", '{"chapters":[{"title":"第1章","page":'],
    ["JSON of another shape", '{"toc":"第1章"}'],
    ["chapters whose pages are not numbers", '{"chapters":[{"title":"第1章","page":"三"}]}'],
    ["no chapters at all", '{"chapters":[]}'],
    ["only chapters without a title", '{"chapters":[{"title":"","page":1}]}'],
  ])("answers null for %s", (_, reply) => {
    expect(readGeneratedOutline(reply, 10)).toBeNull();
  });
});
