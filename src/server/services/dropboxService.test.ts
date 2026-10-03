import { describe, expect, it } from "vite-plus/test";
import { headerSafeJson, isInsideFolder } from "./dropboxService";

describe("headerSafeJson", () => {
  it("escapes everything past ASCII and still reads back as the same value", () => {
    const value = { path: "/本/Rust — 入門.pdf" };
    const encoded = headerSafeJson(value);
    expect(encoded).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(encoded)).toStrictEqual(value);
  });
});

describe("isInsideFolder", () => {
  it("takes the folder's files and those of the folders under it", () => {
    expect(isInsideFolder("/books/a.pdf", "/Books")).toBe(true);
    expect(isInsideFolder("/books/rust/a.pdf", "/Books")).toBe(true);
  });

  it("does not take a sibling whose name only starts the same", () => {
    expect(isInsideFolder("/books-old/a.pdf", "/Books")).toBe(false);
  });

  it("takes everything when the folder is the root", () => {
    expect(isInsideFolder("/anywhere/a.pdf", "/")).toBe(true);
  });
});
