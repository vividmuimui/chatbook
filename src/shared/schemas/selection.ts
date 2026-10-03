import { z } from "zod";

/** One line of a highlight, in the page's own pixels. */
export const selectionRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type SelectionRect = z.infer<typeof selectionRectSchema>;

/**
 * The stored geometry of a highlight, and the only shape the viewer draws from.
 *
 * Unknown keys are stripped rather than rejected: the viewer sends its whole
 * measurement object (which also carries the text offsets it used to find the
 * passage), and rows written before this shape existed carry those extras too.
 */
export const positionDataSchema = z.object({
  rects: z.array(selectionRectSchema),
  /** Page width the rects were measured at, so they can be rescaled later.
   * Missing on records stored before the viewer could be resized. */
  pageWidth: z.number().positive().optional(),
  /**
   * Where the passage sits in its chapter's text, as character offsets into
   * the drawn chapter's `textContent` (end exclusive). EPUB only: a chapter
   * reflows with the width of the pane, so the rects measured when the passage
   * was chosen stop lining up with it, and the viewer draws from this instead.
   */
  textRange: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .refine((range) => range.end > range.start)
    .optional(),
});

export type PositionData = z.infer<typeof positionDataSchema>;

/**
 * The colours a highlight can be, as stored. Kindle's four: yellow, blue, pink
 * and orange. Yellow comes first because it is the column's default — every
 * row stored before colours could be chosen is yellow, and so is a highlight
 * made by asking a question, which picks no colour of its own.
 *
 * An allowlist rather than any `#RRGGBB`: the screen offers these four, and a
 * colour it cannot offer is one the reader could never pick again once it is
 * changed away from.
 */
export const HIGHLIGHT_COLORS = ["#FFEB3B", "#42A5F5", "#EC407A", "#FF9800"] as const;

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0];

export const highlightColorSchema = z.enum(HIGHLIGHT_COLORS);

export type HighlightColor = z.infer<typeof highlightColorSchema>;

/** A page of thoughts, not an essay: long enough to write in, short enough to bound LIKE. */
export const MAX_NOTE_LENGTH = 2000;

/**
 * A note as the reader sends it. Blank is no note: it is stored as null, so a
 * note emptied in the editor is a note taken away rather than an empty one kept.
 */
const noteInputSchema = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .transform((note) => (note.trim() === "" ? null : note.trim()));

/** A highlight of the open book, as the viewer draws it and the list shows it. */
export const selectionHighlightSchema = z.object({
  id: z.string(),
  selectedText: z.string(),
  pageNumber: z.number().int().positive(),
  positionData: positionDataSchema,
  color: z.string(),
  /** What the reader wrote against the passage. Null when they wrote nothing. */
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type SelectionHighlight = z.infer<typeof selectionHighlightSchema>;

/**
 * What the viewer sends when the reader highlights a passage.
 *
 * Colour and note are both optional: a highlight made by asking a question
 * names neither, and is stored yellow with no note.
 */
export const createSelectionRequestSchema = z.object({
  selectedText: z.string().min(1),
  pageNumber: z.number().int().positive(),
  positionData: positionDataSchema,
  color: highlightColorSchema.optional(),
  note: noteInputSchema.nullable().optional(),
});

export type CreateSelectionRequest = z.input<typeof createSelectionRequestSchema>;

/** The highlight as it comes back from its own creation: the stored row. */
export const createdSelectionSchema = selectionHighlightSchema;

export type CreatedSelection = z.infer<typeof createdSelectionSchema>;

/**
 * A change to a highlight the reader already made. Either field may be left
 * out to keep what is stored; a note of null (or blank) takes the note away.
 */
export const updateSelectionRequestSchema = z
  .object({
    color: highlightColorSchema.optional(),
    note: noteInputSchema.nullable().optional(),
  })
  .refine((change) => change.color !== undefined || change.note !== undefined);

export type UpdateSelectionRequest = z.input<typeof updateSelectionRequestSchema>;

/** The highlight's colour and note as they stand after a change. */
export const selectionUpdatedSchema = z.object({
  id: z.string(),
  color: z.string(),
  note: z.string().nullable(),
});

export type SelectionUpdated = z.infer<typeof selectionUpdatedSchema>;

export const selectionDeletedSchema = z.object({ deleted: z.literal(true) });

/** Long enough for a sentence a reader pastes back in, short enough to bound the LIKE. */
export const MAX_SEARCH_QUERY_LENGTH = 200;

export const selectionSearchQuerySchema = z.object({
  q: z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH),
});

/**
 * Which highlights the search matched, by id alone.
 *
 * The list already holds the highlights themselves, read from the book; sending
 * them again would put the same data in two places and let the two disagree.
 */
export const selectionSearchResultSchema = z.object({
  selectionIds: z.array(z.string()),
});

export type SelectionSearchResult = z.infer<typeof selectionSearchResultSchema>;
