import { HIGHLIGHT_COLORS, type HighlightColor } from "../../shared/schemas/selection";

/** What the reader calls each colour, for the buttons that pick one. */
const COLOR_NAMES: Record<HighlightColor, string> = {
  "#FFEB3B": "黄",
  "#42A5F5": "青",
  "#EC407A": "ピンク",
  "#FF9800": "オレンジ",
};

/** The colours a highlight can be, in the order they are offered. */
export const HIGHLIGHT_CHOICES: { value: HighlightColor; name: string }[] = HIGHLIGHT_COLORS.map(
  (value) => ({ value, name: COLOR_NAMES[value] }),
);
