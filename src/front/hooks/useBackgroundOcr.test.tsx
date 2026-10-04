import type { ReactNode } from "react";
import { describe, it, expect } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import { okAsync } from "neverthrow";
import { useBackgroundOcr, type ReadStoredBookByOcr } from "./useBackgroundOcr";
import { bookKey } from "./useBook";
import { ocrKey } from "./useOcrText";
import { createOcrQueue } from "../lib/ocrQueue";
import { SHELF_KEY } from "../lib/shelfKey";
import type { BookDetail, BookSummary } from "../../shared/schemas/book";

const PDF_ID = "scan-1";

const PAGES = [
  { pageNumber: 1, lines: [{ text: "灯台の記録", x: 72, y: 90, width: 120, height: 14 }] },
];

const WAITING_BOOK: BookDetail = {
  id: PDF_ID,
  fileName: "scan.pdf",
  format: "pdf",
  pageCount: 1,
  hasThumbnail: false,
  hasOutline: false,
  hasOcr: false,
  ocrPending: true,
  selections: [],
  readingState: null,
  title: null,
  pageDirection: "ltr",
};

const WAITING_SUMMARY: BookSummary = {
  id: PDF_ID,
  fileName: "scan.pdf",
  format: "pdf",
  pageCount: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  hasThumbnail: false,
  inDropbox: false,
  lastReadPage: null,
  title: null,
  ocrPending: true,
};

describe("useBackgroundOcr", () => {
  it("files what was read where the reader and the shelf read it, once it is stored", async () => {
    // Wherever the reader is when the reading ends, the book they have open
    // draws its text layer and the shelf drops its notice without asking again.
    const cache: Cache = new Map();
    cache.set(bookKey(PDF_ID), { data: WAITING_BOOK });
    cache.set(SHELF_KEY, { data: [WAITING_SUMMARY] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    );
    const read: ReadStoredBookByOcr = async () => ({ fullText: "灯台の記録", pages: PAGES });
    const saved: string[] = [];
    const { result } = renderHook(
      () =>
        useBackgroundOcr({
          read,
          save: (pdfId, body) => {
            saved.push(body.fullText);
            return okAsync({ id: pdfId, hasOcr: true });
          },
          queue: createOcrQueue(),
        }),
      { wrapper },
    );

    act(() => result.current.start(PDF_ID));

    await waitFor(() => expect(result.current.jobs.size).toBe(0));
    expect(saved).toStrictEqual(["灯台の記録"]);
    expect(cache.get(bookKey(PDF_ID))?.data).toMatchObject({ hasOcr: true, ocrPending: false });
    expect(cache.get(ocrKey(PDF_ID))?.data).toStrictEqual({ pages: PAGES });
    expect(cache.get(SHELF_KEY)?.data).toStrictEqual([{ ...WAITING_SUMMARY, ocrPending: false }]);
  });
});
