import { describe, it, expect } from "vite-plus/test";
import { groupShelf, splitHidden, titleOf } from "./shelfGroups";
import type { BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";

function book(id: string, fileName: string, format: "pdf" | "epub" = "pdf"): BookSummary {
  return {
    id,
    fileName,
    format,
    pageCount: 10,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
  };
}

function file(dropboxId: string, name: string): DropboxFile {
  return { dropboxId, name, path: `/${name}`, size: 1 };
}

describe("groupShelf", () => {
  it("puts a PDF and an EPUB of the same name into one entry", () => {
    const groups = groupShelf([book("a", "Rust入門.pdf"), book("b", "Rust入門.epub", "epub")], []);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Rust入門");
    expect(groups[0].members.map((m) => m.key)).toStrictEqual(["a", "b"]);
  });

  it("joins a Dropbox file to the book it shares a name with, books first", () => {
    const groups = groupShelf([book("a", "Rust入門.pdf")], [file("id:1", "Rust入門.epub")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => [m.kind, m.format])).toStrictEqual([
      ["book", "pdf"],
      ["dropbox", "epub"],
    ]);
  });

  it("orders PDF before EPUB whichever arrived first", () => {
    const groups = groupShelf([book("b", "x.epub", "epub"), book("a", "x.pdf")], []);

    expect(groups[0].members.map((m) => m.format)).toStrictEqual(["pdf", "epub"]);
  });

  it("ignores case and Unicode normalization when comparing names", () => {
    // が as one code point, and as か plus the combining mark.
    const groups = groupShelf([book("a", "が.PDF"), book("b", "が.epub", "epub")], []);

    expect(groups).toHaveLength(1);
  });

  it("keeps different names apart, in the order they first appeared", () => {
    const groups = groupShelf([book("a", "one.pdf"), book("b", "two.pdf")], [file("id:1", "three.pdf")]);

    expect(groups.map((g) => g.title)).toStrictEqual(["one", "two", "three"]);
  });

  it("reads the format of a Dropbox file off its name", () => {
    const [group] = groupShelf([], [file("id:1", "x.EPUB"), file("id:2", "x.pdf")]);

    expect(group.members.map((m) => m.format)).toStrictEqual(["pdf", "epub"]);
  });
});

describe("splitHidden", () => {
  const groups = groupShelf(
    [book("a", "one.pdf"), book("b", "two.pdf"), book("c", "two.epub", "epub")],
    [],
  );

  it("shows everything when nothing is put away", () => {
    expect(splitHidden(groups, new Set()).hidden).toHaveLength(0);
  });

  it("puts away an entry only when every file in it is hidden", () => {
    const { shown, hidden } = splitHidden(groups, new Set(["a", "b"]));

    // "two" still has an EPUB the reader has not put away.
    expect(hidden.map((g) => g.title)).toStrictEqual(["one"]);
    expect(shown.map((g) => g.title)).toStrictEqual(["two"]);
  });

  it("puts away a whole entry once all its files are hidden", () => {
    const { shown, hidden } = splitHidden(groups, new Set(["b", "c"]));

    expect(hidden.map((g) => g.title)).toStrictEqual(["two"]);
    expect(shown.map((g) => g.title)).toStrictEqual(["one"]);
  });
});

describe("titleOf", () => {
  it("drops only a trailing book extension", () => {
    expect(titleOf("a.pdf.epub")).toBe("a.pdf");
    expect(titleOf("notes.txt")).toBe("notes.txt");
  });
});
