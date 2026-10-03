import { describe, it, expect } from "vite-plus/test";
import { bookTitle, titleOf } from "./bookTitle";

describe("titleOf", () => {
  it("drops only a trailing book extension", () => {
    expect(titleOf("a.pdf.epub")).toBe("a.pdf");
    expect(titleOf("notes.txt")).toBe("notes.txt");
  });
});

describe("bookTitle", () => {
  it("calls a book by the title the reader gave it", () => {
    expect(bookTitle({ fileName: "scan_0001.pdf", title: "Rust 入門" })).toBe("Rust 入門");
  });

  it("calls a book never renamed by its file name, less the extension", () => {
    expect(bookTitle({ fileName: "Rust 入門.epub", title: null })).toBe("Rust 入門");
  });
});
