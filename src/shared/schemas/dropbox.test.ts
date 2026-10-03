import { describe, expect, it } from "vite-plus/test";
import { normalizeDropboxFolder } from "./dropbox";

describe("normalizeDropboxFolder", () => {
  it.each([
    ["/Books", "/Books"],
    ["Books", "/Books"],
    ["/Books/", "/Books"],
    ["  /技術書/Rust  ", "/技術書/Rust"],
    ["/", "/"],
  ])("spells %j as %j", (input, expected) => {
    expect(normalizeDropboxFolder(input)).toBe(expected);
  });

  it.each(["", "   ", "/a//b", "//"])("refuses %j", (input) => {
    expect(normalizeDropboxFolder(input)).toBeNull();
  });
});
