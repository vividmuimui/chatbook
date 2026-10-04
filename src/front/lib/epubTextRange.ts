import { locateQuoteInSpans, type PassageContext } from "./citedPassage";
import { firstIndexAtOrAfter, screenOfX } from "./epubPaging";

/**
 * Where a passage sits in a drawn chapter, as offsets into its text.
 *
 * An EPUB chapter reflows with the width of the pane, so a passage is kept by
 * where it is in the chapter's text rather than by where it was drawn. These
 * offsets are into the concatenated text nodes under the chapter element — its
 * `textContent` — and stay put whatever size the chapter is drawn at.
 */
export interface TextOffsets {
  start: number;
  /** Exclusive. */
  end: number;
}

/** The chapter's text nodes, in document order. */
function textNodesOf(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** How many characters of the chapter's text come before a point in it. */
function offsetOf(root: Node, container: Node, offset: number): number {
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(container, offset);
  return before.toString().length;
}

/**
 * The offsets a range covers within a chapter, or null when none of it is in
 * the chapter or it covers no text.
 *
 * A range that runs past either end of the chapter is cut to it, for the same
 * reason a drag across two PDF pages is (`rangeWithinPage`): only the part on
 * this chapter has anywhere to be drawn.
 */
export function textOffsetsOf(root: Element, range: Range): TextOffsets | null {
  if (!range.intersectsNode(root)) return null;

  const inside = range.cloneRange();
  if (!root.contains(inside.startContainer)) inside.setStart(root, 0);
  if (!root.contains(inside.endContainer)) inside.setEnd(root, root.childNodes.length);

  const start = offsetOf(root, inside.startContainer, inside.startOffset);
  const end = offsetOf(root, inside.endContainer, inside.endOffset);
  return end > start ? { start, end } : null;
}

/**
 * The range a pair of offsets covers in a drawn chapter, or null when the
 * chapter's text is no longer that long (the book was re-read with different
 * text, say) — such a highlight stays in the list, undrawn.
 */
export function rangeOfTextOffsets(root: Element, { start, end }: TextOffsets): Range | null {
  let seen = 0;
  let startPoint: { node: Text; offset: number } | null = null;

  for (const node of textNodesOf(root)) {
    const length = node.data.length;
    if (!startPoint && start < seen + length) startPoint = { node, offset: start - seen };
    if (startPoint && end <= seen + length) {
      const range = document.createRange();
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}

/**
 * The range a quoted passage covers in a drawn chapter, or null when the
 * chapter does not hold it.
 *
 * Matched the way a PDF page is (`locateQuoteInSpans`), with the chapter's text
 * nodes standing in for pdf.js' text items.
 */
export function rangeOfQuote(root: Element, quote: string, context?: PassageContext): Range | null {
  const nodes = textNodesOf(root);
  const location = locateQuoteInSpans(
    nodes.map((node) => node.data),
    quote,
    context,
  );
  if (!location) return null;

  const range = document.createRange();
  range.setStart(nodes[location.startSpan], location.startOffset);
  range.setEnd(nodes[location.endSpan], location.endOffset);
  return range;
}

/**
 * The screen each character of a chapter laid out in columns is drawn on,
 * asked of the layout one character at a time.
 */
function screensOfCharacters(root: Element, page: Element, viewWidth: number) {
  const nodes = textNodesOf(root);
  const starts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    starts.push(total);
    total += node.data.length;
  }
  const pageLeft = page.getBoundingClientRect().left;

  /** The node a character is in, by halving over where each one starts. */
  const nodeAt = (offset: number) => {
    let low = 0;
    let high = nodes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const screenAt = (offset: number): number | null => {
    const index = nodeAt(offset);
    const range = document.createRange();
    range.setStart(nodes[index], offset - starts[index]);
    range.setEnd(nodes[index], offset - starts[index] + 1);
    const rect = range.getClientRects()[0];
    return rect ? screenOfX(rect.left - pageLeft, viewWidth) : null;
  };

  return { total, screenAt };
}

/**
 * The first character at or after `from` that is drawn at all.
 *
 * The search for a place stops on the white space before the first character
 * it wants — between two paragraphs, say, which is drawn nowhere — and a place
 * on that white space counts as before the heading that follows it, which is
 * where an entry of the contents starts: the section would not count as reached.
 */
function firstDrawn(total: number, valueAt: (offset: number) => number | null, from: number) {
  for (let i = from; i < total; i++) {
    if (valueAt(i) !== null) return i;
  }
  return total;
}

/**
 * The box each character of a chapter is drawn in, relative to the page
 * element, asked of the layout one character at a time — what a chapter read
 * by scrolling, down one column, is placed by.
 */
function boxesOfCharacters(root: Element, page: Element) {
  const nodes = textNodesOf(root);
  const starts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    starts.push(total);
    total += node.data.length;
  }
  const pageTop = page.getBoundingClientRect().top;

  const nodeAt = (offset: number) => {
    let low = 0;
    let high = nodes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  /** The box a character is drawn in, or null for one with nothing drawn. */
  const boxAt = (offset: number): DOMRect | null => {
    const index = nodeAt(offset);
    const range = document.createRange();
    range.setStart(nodes[index], offset - starts[index]);
    range.setEnd(nodes[index], offset - starts[index] + 1);
    return range.getClientRects()[0] ?? null;
  };
  /** How far down the page a character's line ends. */
  const bottomAt = (offset: number) => {
    const box = boxAt(offset);
    return box ? box.bottom - pageTop : null;
  };
  /** How far down the page a character's line starts. */
  const topAt = (offset: number) => {
    const box = boxAt(offset);
    return box ? box.top - pageTop : null;
  };

  return { total, bottomAt, topAt };
}

/**
 * Where in the chapter's text the first line at or below `y` (pixels down the
 * page element) starts — the reader's place in a chapter read by scrolling,
 * taken at the top of the view. Null past the end of the text.
 */
export function textOffsetAtY(root: Element, page: Element, y: number): number | null {
  const { total, bottomAt } = boxesOfCharacters(root, page);
  // A line only partly scrolled off is still being read
  const offset = firstDrawn(total, bottomAt, firstIndexAtOrAfter(total, bottomAt, y + 1));
  return offset < total ? offset : null;
}

/**
 * How far down the page element a place in the chapter's text is drawn, or
 * null past its end. A character with nothing drawn is read as the next one
 * that is, as `screenOfTextOffset` reads it.
 */
export function yOfTextOffset(root: Element, page: Element, offset: number): number | null {
  const { total, topAt } = boxesOfCharacters(root, page);
  for (let i = Math.max(0, offset); i < total; i++) {
    const top = topAt(i);
    if (top !== null) return top;
  }
  return null;
}

/**
 * Where in the chapter's text a screen starts — the first character drawn on
 * it — or null when the chapter's text does not reach it.
 *
 * What a reader's place within a chapter is kept as, since the screen it was on
 * stops meaning anything once the chapter is laid out again at another width
 * or in another type.
 */
export function textOffsetOfScreen(
  root: Element,
  page: Element,
  viewWidth: number,
  screen: number,
): number | null {
  const { total, screenAt } = screensOfCharacters(root, page, viewWidth);
  const offset = firstDrawn(total, screenAt, firstIndexAtOrAfter(total, screenAt, screen));
  return offset < total ? offset : null;
}

/**
 * The screen a place in the chapter's text is drawn on, or null past the end of
 * it. A character with nothing drawn — the white space between two paragraphs —
 * is read as the next one that is.
 */
export function screenOfTextOffset(
  root: Element,
  page: Element,
  viewWidth: number,
  offset: number,
): number | null {
  const { total, screenAt } = screensOfCharacters(root, page, viewWidth);
  for (let i = Math.max(0, offset); i < total; i++) {
    const screen = screenAt(i);
    if (screen !== null) return screen;
  }
  return null;
}
