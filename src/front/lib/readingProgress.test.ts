import { describe, it, expect } from "vite-plus/test";
import { groupProgress, readingPercent } from "./readingProgress";
import { groupShelf } from "./shelfGroups";
import type { BookFormat, BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";

function book(
  id: string,
  fileName: string,
  pageCount: number,
  lastReadPage: number | null,
  format: BookFormat = "pdf",
): BookSummary {
  return {
    id,
    fileName,
    format,
    pageCount,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
    lastReadPage,
  };
}

function file(dropboxId: string, name: string): DropboxFile {
  return { dropboxId, name, path: `/${name}`, size: 1 };
}

describe("readingPercent", () => {
  it("says nothing for a book that has never been opened", () => {
    expect(readingPercent(null, 200)).toBeNull();
  });

  it("is the share of the book's pages the reader has reached", () => {
    expect(readingPercent(24, 200)).toBe(12);
    expect(readingPercent(1, 4)).toBe(25);
  });

  it("is 100 on the last page", () => {
    expect(readingPercent(200, 200)).toBe(100);
    expect(readingPercent(1, 1)).toBe(100);
  });

  it("keeps 100 for a book that has been finished, rounding down short of it", () => {
    // 199 / 200 = 99.5: rounding to nearest would call an unfinished book done.
    expect(readingPercent(199, 200)).toBe(99);
  });

  it("is 0 on the first page of a long book", () => {
    expect(readingPercent(1, 300)).toBe(0);
  });

  it("stays within the book when the saved page no longer does", () => {
    // A book stored again shorter than it was keeps the page saved before.
    expect(readingPercent(250, 200)).toBe(100);
    expect(readingPercent(0, 200)).toBe(0);
  });
});

describe("groupProgress", () => {
  it("is how far the furthest-read book of the entry has got", () => {
    const [group] = groupShelf(
      [book("a", "Rust入門.pdf", 200, 20), book("b", "Rust入門.epub", 10, 5, "epub")],
      [],
    );

    expect(groupProgress(group)).toBe(50);
  });

  it("ignores the books of the entry never opened", () => {
    const [group] = groupShelf(
      [book("a", "Rust入門.pdf", 200, null), book("b", "Rust入門.epub", 10, 3, "epub")],
      [],
    );

    expect(groupProgress(group)).toBe(30);
  });

  it("says nothing when no book of the entry has been opened", () => {
    const [group] = groupShelf(
      [book("a", "Rust入門.pdf", 200, null)],
      [file("id:1", "Rust入門.epub")],
    );

    expect(groupProgress(group)).toBeNull();
  });

  it("says nothing for an entry that is only a file waiting in Dropbox", () => {
    const [group] = groupShelf([], [file("id:1", "Rust入門.epub")]);

    expect(groupProgress(group)).toBeNull();
  });
});
