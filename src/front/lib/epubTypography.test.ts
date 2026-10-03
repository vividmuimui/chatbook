import { describe, it, expect } from "vite-plus/test";
import {
  DEFAULT_EPUB_TYPOGRAPHY,
  EPUB_FONT_SIZES_PX,
  epubTypographySchema,
  epubTypographyStyle,
  stepFontSize,
} from "./epubTypography";

describe("epubTypographyStyle", () => {
  it("draws a reader who chose nothing as the chapter was drawn before there was a choice", () => {
    expect(epubTypographyStyle(DEFAULT_EPUB_TYPOGRAPHY)).toStrictEqual({
      "--epub-font-size": "17px",
      "--epub-line-height": "1.9",
      "--epub-text-align": "start",
      "--epub-font-family": expect.stringMatching(/^"Hiragino Sans".*sans-serif$/),
      "--epub-page-margin": "8%",
    });
  });

  it("hands each choice to its own property", () => {
    expect(
      epubTypographyStyle({
        fontSizeStep: 9,
        lineHeight: "loose",
        textAlign: "justify",
        fontFamily: "serif",
        margin: "wide",
      }),
    ).toStrictEqual({
      "--epub-font-size": "32px",
      "--epub-line-height": "2.2",
      "--epub-text-align": "justify",
      "--epub-font-family": expect.stringMatching(/^"Hiragino Mincho ProN".*serif$/),
      "--epub-page-margin": "14%",
    });
  });
});

describe("stepFontSize", () => {
  it("goes one step either way", () => {
    expect(stepFontSize(DEFAULT_EPUB_TYPOGRAPHY, 1).fontSizeStep).toBe(5);
    expect(stepFontSize(DEFAULT_EPUB_TYPOGRAPHY, -1).fontSizeStep).toBe(3);
  });

  it("stops at the smallest and the largest size", () => {
    const smallest = { ...DEFAULT_EPUB_TYPOGRAPHY, fontSizeStep: 0 };
    const largest = { ...DEFAULT_EPUB_TYPOGRAPHY, fontSizeStep: EPUB_FONT_SIZES_PX.length - 1 };
    expect(stepFontSize(smallest, -1)).toStrictEqual(smallest);
    expect(stepFontSize(largest, 1)).toStrictEqual(largest);
  });
});

describe("epubTypographySchema", () => {
  it("keeps the choices a reader made when one field is something it cannot be", () => {
    expect(
      epubTypographySchema.parse({
        fontSizeStep: 99,
        lineHeight: "loose",
        textAlign: "center",
        fontFamily: "serif",
      }),
    ).toStrictEqual({
      fontSizeStep: DEFAULT_EPUB_TYPOGRAPHY.fontSizeStep,
      lineHeight: "loose",
      textAlign: DEFAULT_EPUB_TYPOGRAPHY.textAlign,
      fontFamily: "serif",
      margin: DEFAULT_EPUB_TYPOGRAPHY.margin,
    });
  });

  it("refuses something that is not a setting at all", () => {
    expect(epubTypographySchema.safeParse("large").success).toBe(false);
  });
});
