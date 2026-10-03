import { describe, it, expect } from "vite-plus/test";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { errAsync, okAsync } from "neverthrow";
import { usePageDirection, type SavePageDirection } from "./usePageDirection";
import { bookKey } from "./useBook";
import { ApiError } from "../lib/fetcher";
import { SwrTestCache } from "../../test/swrTestCache";
import type { BookDetail, PageDirection } from "../../shared/schemas/book";

const PDF_ID = "book-1";

const BOOK: BookDetail = {
  id: PDF_ID,
  fileName: "tategaki.pdf",
  format: "pdf",
  pageCount: 12,
  hasThumbnail: false,
  hasOutline: false,
  pageDirection: "ltr",
  selections: [],
  readingState: null,
};

function renderDirection(save: SavePageDirection) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SwrTestCache seed={{ [bookKey(PDF_ID)]: BOOK }}>{children}</SwrTestCache>
  );
  return renderHook(() => ({ direction: usePageDirection(PDF_ID, save) }), { wrapper });
}

describe("usePageDirection", () => {
  it("reads the direction off the book", () => {
    const { result } = renderDirection(() => okAsync("ltr"));

    expect(result.current.direction.direction).toBe("ltr");
  });

  it("turns the book the other way once the server has taken it", async () => {
    const asked: [string, PageDirection][] = [];
    const { result } = renderDirection((pdfId, direction) => {
      asked.push([pdfId, direction]);
      return okAsync(direction);
    });

    await act(async () => {
      await result.current.direction.changeDirection("rtl");
    });

    expect(asked).toStrictEqual([[PDF_ID, "rtl"]]);
    await waitFor(() => expect(result.current.direction.direction).toBe("rtl"));
    expect(result.current.direction.error).toBeNull();
  });

  it("keeps the direction and hands back the reason when the server refuses", async () => {
    const { result } = renderDirection(() =>
      errAsync(new ApiError("Failed to fetch", "NETWORK_ERROR", 0, "network")),
    );

    await act(async () => {
      await result.current.direction.changeDirection("rtl");
    });

    expect(result.current.direction.direction).toBe("ltr");
    expect(result.current.direction.error).toBe("Failed to fetch");
  });
});
