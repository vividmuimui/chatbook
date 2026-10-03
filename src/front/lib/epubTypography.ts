import { z } from "zod";

/**
 * The type sizes an EPUB can be read at, in px, smallest first.
 *
 * Steps rather than a free number, as a Kindle has them: the reader wants
 * "one size larger", not 18.5px. The default step is the size the chapter was
 * drawn at before the reader could choose (1.0625rem).
 */
export const EPUB_FONT_SIZES_PX = [12, 13, 14, 15, 17, 19, 21, 24, 28, 32] as const;

/** The step a reader who has chosen nothing reads at. */
export const DEFAULT_FONT_SIZE_STEP = 4;

export const EPUB_LINE_HEIGHTS = {
  tight: 1.5,
  snug: 1.7,
  normal: 1.9,
  loose: 2.2,
} as const;
export type EpubLineHeight = keyof typeof EPUB_LINE_HEIGHTS;

export type EpubTextAlign = "start" | "justify";

/**
 * The faces, named by kind rather than by font: no web font is loaded, so each
 * is a stack of what Mac, Windows and Linux already have, Japanese faces first
 * — Latin glyphs in them are fine, but a Latin face first would leave the kana
 * to whatever the system falls back to.
 */
export const EPUB_FONT_FAMILIES = {
  sans: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", "Noto Sans CJK JP", Meiryo, system-ui, sans-serif',
  serif:
    '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", "Times New Roman", serif',
} as const;
export type EpubFontFamily = keyof typeof EPUB_FONT_FAMILIES;

/**
 * The page's side margins, as a share of the page's own width. A share rather
 * than a length so a phone and a wide window both keep their proportions; the
 * page itself stops growing at its maximum width, so on a wide window the
 * margins stop growing with it.
 */
export const EPUB_MARGINS = {
  narrow: "4%",
  normal: "8%",
  wide: "14%",
} as const;
export type EpubMargin = keyof typeof EPUB_MARGINS;

const fontSizeStepSchema = z
  .number()
  .int()
  .min(0)
  .max(EPUB_FONT_SIZES_PX.length - 1);

export interface EpubTypography {
  fontSizeStep: number;
  lineHeight: EpubLineHeight;
  textAlign: EpubTextAlign;
  fontFamily: EpubFontFamily;
  margin: EpubMargin;
}

export const DEFAULT_EPUB_TYPOGRAPHY: EpubTypography = {
  fontSizeStep: DEFAULT_FONT_SIZE_STEP,
  lineHeight: "normal",
  textAlign: "start",
  fontFamily: "sans",
  margin: "normal",
};

const keysOf = <T extends object>(record: T) =>
  Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];

/**
 * What a stored setting has to be. Each field falls back to its own default,
 * so one value an older release wrote differently — or a field added since —
 * does not cost the reader every other choice they made. Anything that is not
 * an object at all is refused whole, and the storage falls back to the
 * defaults.
 */
export const epubTypographySchema: z.ZodType<EpubTypography> = z.object({
  fontSizeStep: fontSizeStepSchema.catch(DEFAULT_EPUB_TYPOGRAPHY.fontSizeStep),
  lineHeight: z.enum(keysOf(EPUB_LINE_HEIGHTS)).catch(DEFAULT_EPUB_TYPOGRAPHY.lineHeight),
  textAlign: z.enum(["start", "justify"]).catch(DEFAULT_EPUB_TYPOGRAPHY.textAlign),
  fontFamily: z.enum(keysOf(EPUB_FONT_FAMILIES)).catch(DEFAULT_EPUB_TYPOGRAPHY.fontFamily),
  margin: z.enum(keysOf(EPUB_MARGINS)).catch(DEFAULT_EPUB_TYPOGRAPHY.margin),
});

/** The custom properties `index.css` draws the chapter with, set on the page that holds it. */
export function epubTypographyStyle(typography: EpubTypography): Record<string, string> {
  return {
    "--epub-font-size": `${EPUB_FONT_SIZES_PX[typography.fontSizeStep]}px`,
    "--epub-line-height": String(EPUB_LINE_HEIGHTS[typography.lineHeight]),
    "--epub-text-align": typography.textAlign,
    "--epub-font-family": EPUB_FONT_FAMILIES[typography.fontFamily],
    "--epub-page-margin": EPUB_MARGINS[typography.margin],
  };
}

/** One step larger or smaller, held to the steps there are. */
export function stepFontSize(typography: EpubTypography, by: 1 | -1): EpubTypography {
  const fontSizeStep = Math.min(
    EPUB_FONT_SIZES_PX.length - 1,
    Math.max(0, typography.fontSizeStep + by),
  );
  return { ...typography, fontSizeStep };
}
