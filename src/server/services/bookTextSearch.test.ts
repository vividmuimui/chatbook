import { describe, it, expect } from "vite-plus/test";
import { findInBookText, SNIPPET_CONTEXT_LENGTH } from "./bookTextSearch";

/** pdfLoader / epubLoader が作る fullText と同じ形 (ページ区切りは \f) */
function fullTextOf(...pages: string[]): string {
  return pages.join("\f");
}

describe("findInBookText", () => {
  it("answers with the page each match is on, counting from 1", () => {
    const found = findInBookText(fullTextOf("alpha", "beta gamma", "gamma"), "gamma");

    expect(found.matches.map((match) => match.pageNumber)).toStrictEqual([2, 3]);
    expect(found.truncated).toBe(false);
  });

  it("cuts each match into what came before it, itself, and what came after", () => {
    const found = findInBookText("Workers run at the edge of the network", "the edge");

    expect(found.matches).toStrictEqual([
      { pageNumber: 1, before: "Workers run at ", match: "the edge", after: " of the network" },
    ]);
  });

  it("finds every match on a page, not just the first", () => {
    const found = findInBookText("cat and cat and cat", "cat");

    expect(found.matches).toHaveLength(3);
    expect(found.matches[1]).toMatchObject({ before: "cat and ", match: "cat", after: " and cat" });
  });

  it("ignores the case of ASCII letters, and hands back the book's own spelling", () => {
    const found = findInBookText("Cloudflare WORKERS", "workers");

    expect(found.matches[0].match).toBe("WORKERS");
  });

  it("matches across a line break the extraction put in the middle of a word", () => {
    // pdf.js ends a line wherever the page did, which for Japanese is wherever
    // the line filled up — mid-word as often as not
    const found = findInBookText("これは日本\n語の本です", "日本語");

    expect(found.matches).toStrictEqual([
      { pageNumber: 1, before: "これは", match: "日本\n語", after: "の本です" },
    ]);
  });

  it("treats spaces in the query and runs of whitespace in the book alike", () => {
    const found = findInBookText("edge  of\nthe network", "of the");

    expect(found.matches[0].match).toBe("of\nthe");
  });

  it("finds composed and decomposed spellings of the same letters", () => {
    // が as one code point in the book, and as か + the voiced mark in the query
    const found = findInBookText("ながい", "が");

    expect(found.matches[0].match).toBe("が");
  });

  it("does not let a match run on from one page to the next", () => {
    const found = findInBookText(fullTextOf("ends with foo", "bar starts"), "foobar");

    expect(found.matches).toStrictEqual([]);
  });

  it("keeps the context to the page the match is on", () => {
    const found = findInBookText(fullTextOf("previous page", "needle here"), "needle");

    expect(found.matches[0]).toMatchObject({ before: "", after: " here" });
  });

  it("keeps only so much context on either side, folding whitespace in it", () => {
    const filler = "x".repeat(SNIPPET_CONTEXT_LENGTH + 10);
    const found = findInBookText(`${filler}\n\n needle \n${filler}`, "needle");

    const [match] = found.matches;
    expect(match.before.endsWith("x ")).toBe(true);
    expect(match.before.length).toBeLessThanOrEqual(SNIPPET_CONTEXT_LENGTH);
    expect(match.after.startsWith(" x")).toBe(true);
    expect(match.after.length).toBeLessThanOrEqual(SNIPPET_CONTEXT_LENGTH);
  });

  it("stops at the limit and says it did", () => {
    const found = findInBookText(fullTextOf("a a a", "a a"), "a", 4);

    expect(found.matches).toHaveLength(4);
    expect(found.truncated).toBe(true);
  });

  it("does not claim to have stopped when the matches came out exactly at the limit", () => {
    const found = findInBookText("a a a", "a", 3);

    expect(found.matches).toHaveLength(3);
    expect(found.truncated).toBe(false);
  });

  it("does not count overlapping matches twice", () => {
    expect(findInBookText("aaaa", "aa").matches).toHaveLength(2);
  });

  it("finds nothing for a query that is only whitespace", () => {
    expect(findInBookText("some text", "  \n").matches).toStrictEqual([]);
  });

  it("treats regular-expression characters as themselves", () => {
    const found = findInBookText("costs $5 (or more)", "(or");

    expect(found.matches[0].match).toBe("(or");
  });
});
