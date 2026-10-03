import { describe, it, expect } from "vite-plus/test";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { errAsync, okAsync } from "neverthrow";
import { useReaderOutline, type GenerateOutline } from "./useReaderOutline";
import { bookKey } from "./useBook";
import { chaptersKey } from "./useChapters";
import { ApiError } from "../lib/fetcher";
import { SwrTestCache } from "../../test/swrTestCache";
import type { BookChapter, BookDetail } from "../../shared/schemas/book";

const PDF_ID = "book-1";

/** A document that ships without a table of contents. */
const NO_OUTLINE = {
  getOutline: () => Promise.resolve(null),
} as unknown as PDFDocumentProxy;

/** A document with one bookmark of its own, on page 2. */
const OWN_OUTLINE = {
  getOutline: () => Promise.resolve([{ title: "まえがき", dest: [1], items: [] }]),
  getPageIndex: (ref: unknown) => Promise.resolve(ref as number),
} as unknown as PDFDocumentProxy;

function book(hasOutline: boolean): BookDetail {
  return {
    id: PDF_ID,
    fileName: "scan.pdf",
    format: "pdf",
    pageCount: 12,
    hasThumbnail: false,
    hasOutline,
    pageDirection: "ltr",
    selections: [],
    readingState: null,
  };
}

const STORED_CHAPTERS: BookChapter[] = [
  { title: null, startPage: 1, endPage: 2 },
  { title: "第1章 はじめに", startPage: 3, endPage: 6 },
  { title: "第2章 しくみ", startPage: 7, endPage: 12 },
];

function renderOutline(
  doc: PDFDocumentProxy,
  stored: BookDetail,
  options: {
    seed?: Record<string, unknown>;
    generate?: GenerateOutline;
    loadChapters?: (pdfId: string) => Promise<{ chapters: BookChapter[] }>;
  } = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SwrTestCache seed={{ [bookKey(PDF_ID)]: stored, ...options.seed }}>{children}</SwrTestCache>
  );
  return renderHook(() => useReaderOutline(PDF_ID, doc, options.generate, options.loadChapters), {
    wrapper,
  });
}

describe("useReaderOutline", () => {
  it("shows the PDF's own bookmarks where it has them", async () => {
    const { result } = renderOutline(OWN_OUTLINE, book(true));

    await waitFor(() =>
      expect(result.current.outline).toStrictEqual([
        { title: "まえがき", pageNumber: 2, children: [] },
      ]),
    );
  });

  it("shows the chapters stored for a PDF that has no bookmarks of its own", async () => {
    // A table of contents made by the model lives only on the server; the
    // document has nothing to say about it.
    const { result } = renderOutline(NO_OUTLINE, book(true), {
      seed: { [chaptersKey(PDF_ID)]: { chapters: STORED_CHAPTERS } },
    });

    await waitFor(() =>
      expect(result.current.outline).toStrictEqual([
        { title: "第1章 はじめに", pageNumber: 3, children: [] },
        { title: "第2章 しくみ", pageNumber: 7, children: [] },
      ]),
    );
  });

  it("says a book with neither has none, without asking the server", async () => {
    const asked: string[] = [];
    const { result } = renderOutline(NO_OUTLINE, book(false), {
      loadChapters: async (pdfId) => {
        asked.push(pdfId);
        return { chapters: [] };
      },
    });

    await waitFor(() => expect(result.current.outline).toStrictEqual([]));
    expect(asked).toStrictEqual([]);
  });

  it("puts the chapters the model made in the panel once they are stored", async () => {
    let stored: BookChapter[] = [];
    const { result } = renderOutline(NO_OUTLINE, book(false), {
      generate: () => {
        stored = STORED_CHAPTERS;
        return okAsync({
          outline: [
            { title: "第1章 はじめに", pageNumber: 3 },
            { title: "第2章 しくみ", pageNumber: 7 },
          ],
        });
      },
      loadChapters: async () => ({ chapters: stored }),
    });
    await waitFor(() => expect(result.current.outline).toStrictEqual([]));

    await act(async () => {
      await result.current.generation.onGenerate();
    });

    await waitFor(() =>
      expect(result.current.outline).toStrictEqual([
        { title: "第1章 はじめに", pageNumber: 3, children: [] },
        { title: "第2章 しくみ", pageNumber: 7, children: [] },
      ]),
    );
    expect(result.current.generation.error).toBeNull();
    expect(result.current.generation.generating).toBe(false);
  });

  it("hands back why none could be made, leaving the book without one", async () => {
    const { result } = renderOutline(NO_OUTLINE, book(false), {
      generate: () =>
        errAsync(new ApiError("The model could not be reached", "AI_API_ERROR", 502, "http")),
    });
    await waitFor(() => expect(result.current.outline).toStrictEqual([]));

    await act(async () => {
      await result.current.generation.onGenerate();
    });

    expect(result.current.generation.error).toBe("The model could not be reached");
    expect(result.current.outline).toStrictEqual([]);
  });
});
