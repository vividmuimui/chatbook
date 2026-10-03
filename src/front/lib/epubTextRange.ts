import { locateQuoteInSpans, type PassageContext } from "./citedPassage";

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
