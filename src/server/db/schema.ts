import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const pdfs = sqliteTable("pdfs", {
  id: text("id").primaryKey(),
  filePath: text("file_path").notNull().unique(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  fullText: text("full_text").notNull(),
  pageCount: integer("page_count").notNull(),
  // Top-level chapters as JSON ({ title, pageNumber }[]). NULL — books stored
  // before the column, or PDFs that ship no outline — sends chat a page window
  // around the highlight instead of a chapter.
  outline: text("outline"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // Where the reader left off. Null on books nobody has opened yet, and on the
  // two panel columns also on books only ever read on a narrow screen, where
  // the outline is a drawer and the chat a sheet rather than places beside the
  // page.
  lastReadPage: integer("last_read_page"),
  lastReadSelectionId: text("last_read_selection_id"),
  // The session of the book's own that was open instead (0013). At most one of
  // the two is set; both null is a place with no conversation open on it. The
  // column it replaced, `last_read_book_chat`, is still in the table and read
  // by nothing.
  lastReadSessionId: text("last_read_session_id"),
  lastReadOutlineOpen: integer("last_read_outline_open", { mode: "boolean" }),
  lastReadChatPanelOpen: integer("last_read_chat_panel_open", { mode: "boolean" }),
  // Dropbox's id for the file this book is ("id:..."). Null for books that live
  // only in R2. When set, Dropbox holds the book and R2 is a copy of it that
  // `/file` refills from Dropbox if it is gone.
  dropboxId: text("dropbox_id").unique(),
  // "pdf" or "epub" (`bookFormatSchema`). Read off the bytes when the book is
  // stored, never off the name the reader gave the file.
  format: text("format").notNull().default("pdf"),
  // The title the reader gave the book (`PATCH /api/pdf/:pdfId`). Null shows
  // the one made from `file_name`, and is what a cleared title goes back to.
  // Re-opening the book from its file leaves it alone.
  title: text("title"),
  // "ltr" or "rtl" (`pageDirectionSchema`): which way the pages turn. Chosen
  // by the reader per book, never read off the file — a PDF does not say.
  pageDirection: text("page_direction").notNull().default("ltr"),
  // "pending" — a book of pictures stored before OCR read it, its text still to
  // come from the browser (`PUT /api/pdf/:pdfId/ocr`) — or "done" once it has.
  // Null for a book with text of its own.
  ocrStatus: text("ocr_status"),
});

/** Settings changed from the screen. One row per key (`dropbox_folder`). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Shelf entries the reader put away: a book's id or a Dropbox file's id. */
export const hiddenBooks = sqliteTable("hidden_books", {
  key: text("key").primaryKey(),
  hiddenAt: text("hidden_at").notNull(),
});

/**
 * Titles the reader gave Dropbox files that are not books yet, by Dropbox id.
 * A book's own title is `pdfs.title`; a file's moves there when it is brought in.
 */
export const bookTitles = sqliteTable("book_titles", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
});

/**
 * The reader's collections (0016). What is in each is `collectionItems`; the
 * books themselves are not owned by one, and deleting it leaves them alone.
 */
export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * What is in a collection, by the keys `hidden_books` uses: a book's id, or a
 * Dropbox id for a file not brought in yet (no foreign key, like there). The
 * import moves a file's rows onto the book it becomes; deleting the book moves
 * them back to its file, or drops them when it has none.
 */
export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    addedAt: text("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.key] })],
);

export const selections = sqliteTable("selections", {
  id: text("id").primaryKey(),
  pdfId: text("pdf_id")
    .notNull()
    .references(() => pdfs.id, { onDelete: "cascade" }),
  selectedText: text("selected_text").notNull(),
  pageNumber: integer("page_number").notNull(),
  positionData: text("position_data").notNull(),
  // One of `HIGHLIGHT_COLORS`. Rows stored before colours could be chosen all
  // took this default, which is the first (yellow) of them.
  color: text("color").notNull().default("#FFEB3B"),
  // What the reader wrote against the passage; null when they wrote nothing.
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

/**
 * One of the book's own conversations (0013). A highlight's conversation needs
 * no record like this — the highlight is its record — but a book can hold any
 * number of these.
 */
export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  pdfId: text("pdf_id")
    .notNull()
    .references(() => pdfs.id, { onDelete: "cascade" }),
  // What the reader named it; null calls it by its first question.
  title: text("title"),
  // The pages its last question was aimed at, as JSON (PageRange[]).
  scope: text("scope"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  // Null for the book's own conversations, which hang off no passage. A
  // highlight's conversation still goes with the highlight: deleting it takes
  // the messages, while the book's own outlive every highlight in it.
  selectionId: text("selection_id").references(() => selections.id, { onDelete: "cascade" }),
  // The session of the book's own the message is in. Set exactly when
  // `selectionId` is not; deleting the session takes its messages.
  sessionId: text("session_id").references(() => chatSessions.id, { onDelete: "cascade" }),
  // Which book the message belongs to. Carried on every row rather than read
  // through the highlight, so a conversation about the book itself has one
  // place to hang from and deleting the book takes all of them.
  pdfId: text("pdf_id")
    .notNull()
    .references(() => pdfs.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: text("citations"),
  // What the answer cost. Null on rows written before this was measured, and on
  // the reader's own messages, which cost nothing on their own.
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  createdAt: text("created_at").notNull(),
});
