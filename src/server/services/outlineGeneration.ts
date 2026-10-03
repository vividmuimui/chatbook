import { z } from "zod";
import {
  MAX_OUTLINE_CHAPTERS,
  MAX_OUTLINE_TITLE_LENGTH,
  type BookOutline,
} from "../../shared/schemas/book";
import type { LlmMessage } from "./chatService";

/**
 * Asking the model for the table of contents a PDF did not ship with.
 *
 * Pure functions only: what is sent, and what is made of the answer. The call
 * itself is `completeChat` in llmService.ts, and storing the result is the
 * route's.
 */

/**
 * How much of a page the model is shown.
 *
 * A chapter announces itself at the top of the page it starts on, so the head
 * of each page is what finding chapters needs — and the whole book would cost
 * a few hundred thousand tokens to ask where its chapters start.
 */
export const OUTLINE_PAGE_HEAD_CHARS = 200;

/**
 * What all the heads together may come to, in characters.
 *
 * A long book is shown less of each page rather than fewer pages: a chapter
 * the model is not shown is a chapter it cannot find.
 */
export const OUTLINE_PROMPT_BUDGET_CHARS = 60_000;

/** Below this a page's head says too little to tell a heading from body text. */
const MIN_PAGE_HEAD_CHARS = 40;

const PAGE_DELIMITER = "\f";

/**
 * The head of every page, one line each, numbered the way the book numbers its
 * pages (`p.3: 第1章 はじめに …`).
 *
 * Pages are counted off the stored text's page breaks, which is where every
 * page number the app shows comes from. Whitespace — line breaks included — is
 * folded to single spaces so each page stays on its own line; a page with
 * nothing on it is left out, keeping the numbers of the rest.
 */
export function pageHeads(fullText: string): string {
  const pages = fullText
    .split(PAGE_DELIMITER)
    .map((page, index) => ({ number: index + 1, text: page.replace(/\s+/g, " ").trim() }))
    .filter((page) => page.text.length > 0);

  const perPage = Math.max(
    MIN_PAGE_HEAD_CHARS,
    Math.min(
      OUTLINE_PAGE_HEAD_CHARS,
      Math.floor(OUTLINE_PROMPT_BUDGET_CHARS / Math.max(1, pages.length)),
    ),
  );

  return pages.map((page) => `p.${page.number}: ${page.text.slice(0, perPage)}`).join("\n");
}

/** What the model is asked, with the heads of the book's pages. */
export function buildOutlineMessages(fullText: string, pageCount: number): LlmMessage[] {
  return [
    {
      role: "system",
      content: `You build the table of contents of a book from the opening lines of each of its pages.
Find where each top-level chapter (or part, or equivalent major section) starts. Skip the cover, the table of contents page itself, and running headers or footers repeated on every page.
Use the chapter titles as they are written in the book, in the book's own language.
Answer with JSON only, in exactly this shape and nothing else:
{"chapters": [{"title": "第1章 はじめに", "page": 3}]}
"page" is the page number shown after "p." on the line where the chapter starts.`,
    },
    {
      role: "user",
      content: `The book has ${pageCount} pages. The opening of each page:\n\n${pageHeads(fullText)}`,
    },
  ];
}

/** One chapter as the model is asked to give it. */
const generatedChapterSchema = z.object({
  title: z.string(),
  page: z.number(),
});

/** The chapters wrapped as asked, or the bare array some models answer with. */
const generatedOutlineReplySchema = z.union([
  z.object({ chapters: z.array(generatedChapterSchema) }),
  z.array(generatedChapterSchema).transform((chapters) => ({ chapters })),
]);

/**
 * The JSON in a reply: the reply itself, or the first object or array in it.
 *
 * Models wrap JSON in a code fence, or say a word before it, however they are
 * asked — and a reply that is all there but for its wrapping is not a reason
 * to charge the reader for a second one.
 */
function jsonIn(reply: string): unknown {
  const candidates = [reply.trim()];
  const start = reply.search(/[[{]/);
  if (start >= 0) {
    const closing = reply[start] === "{" ? "}" : "]";
    const end = reply.lastIndexOf(closing);
    if (end > start) candidates.push(reply.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Not this one; the next candidate is the JSON cut out of the words
      // around it. A reply with none at all ends as undefined below, which the
      // schema refuses.
    }
  }
  return undefined;
}

/**
 * The table of contents in the model's reply, in the shape the book stores, or
 * null when the reply holds none.
 *
 * Each page is brought inside the book (1..pageCount) and rounded, the
 * chapters are put in page order, and only the first chapter said to start on
 * a page is kept: the chapter list is cut at the pages chapters start on, so
 * two on one page is one chapter with two names. Titles are trimmed and held
 * to the stored limits, and a chapter without one is dropped.
 */
export function readGeneratedOutline(reply: string, pageCount: number): BookOutline | null {
  const parsed = generatedOutlineReplySchema.safeParse(jsonIn(reply));
  if (!parsed.success) return null;

  const lastPage = Math.max(1, pageCount);
  const chapters = parsed.data.chapters
    .map(({ title, page }) => ({
      title: title.trim().slice(0, MAX_OUTLINE_TITLE_LENGTH),
      pageNumber: Math.min(lastPage, Math.max(1, Math.round(page))),
    }))
    .filter((chapter) => chapter.title.length > 0 && Number.isFinite(chapter.pageNumber))
    // Stable, so of two chapters on one page the one the model listed first
    // is the one kept below
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .filter(
      (chapter, index, sorted) =>
        index === 0 || sorted[index - 1].pageNumber !== chapter.pageNumber,
    )
    .slice(0, MAX_OUTLINE_CHAPTERS);

  return chapters.length > 0 ? chapters : null;
}
