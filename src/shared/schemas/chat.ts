import { z } from "zod";
import { citationSchema } from "./citation";
import { MAX_OUTLINE_CHAPTERS } from "./book";

/** Who wrote a message in a stored conversation. */
export const chatRoleSchema = z.enum(["user", "assistant"]);

export type ChatRole = z.infer<typeof chatRoleSchema>;

/** A message of the conversation hanging off one highlight. */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  // Questions carry none, and answers written before citations existed carry
  // the null the endpoint substitutes for a missing column.
  citations: z.array(citationSchema).nullish(),
  createdAt: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * A highlight's conversation as it is read back: the messages, and which
 * highlight they hang off. The book's own conversations are sessions, read back
 * as `sessionHistorySchema`.
 */
export const chatHistorySchema = z.object({
  selectionId: z.string(),
  messages: z.array(chatMessageSchema),
});

/** What the reader sends to ask a question about a highlight. */
export const sendChatRequestSchema = z.object({
  content: z.string().min(1),
  // Only a real boolean: the string "false" used to be coerced to true.
  useWebSearch: z.boolean().optional().default(false),
});

export type SendChatRequest = z.infer<typeof sendChatRequestSchema>;

/**
 * A run of pages a question about the book is aimed at.
 *
 * Ranges come from `GET /api/pdf/:pdfId/chapters`, which is where the pages of
 * a chapter are worked out, so the reader picks chapters rather than inventing
 * numbers: a range naming pages the book does not have is clamped when the
 * excerpt is cut, and one entirely outside it is dropped.
 */
export const pageRangeSchema = z
  .object({
    startPage: z.number().int().positive(),
    endPage: z.number().int().positive(),
  })
  .refine((range) => range.endPage >= range.startPage, {
    path: ["endPage"],
    message: "endPage is before startPage",
  });

export type PageRange = z.infer<typeof pageRangeSchema>;

/**
 * How much of the book a question covers. Never empty: the whole book is a
 * range like any other, so there is no second way of saying "everything" and
 * nothing that reads as "no pages at all".
 */
export const chatScopeSchema = z.object({
  ranges: z.array(pageRangeSchema).min(1).max(MAX_OUTLINE_CHAPTERS),
});

export const sendBookChatRequestSchema = sendChatRequestSchema.extend({
  scope: chatScopeSchema,
});

export type SendBookChatRequest = z.infer<typeof sendBookChatRequestSchema>;

/**
 * One of the book's own conversations. A book holds as many as the reader
 * starts — one about the argument, another about a chapter — where a highlight
 * holds exactly one and needs no record of its own.
 *
 * `title` is null until the reader names it; the screen then calls it by the
 * start of its first question (`sessionTitle`). `scope` is the pages its last
 * question was aimed at, which is what the scope menu reopens on; null until
 * something has been asked, read as the whole book.
 */
export const chatSessionSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  scope: z.array(pageRangeSchema).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChatSession = z.infer<typeof chatSessionSchema>;

/** A session as it is opened: the record, and everything said in it. */
export const sessionHistorySchema = z.object({
  session: chatSessionSchema,
  messages: z.array(chatMessageSchema),
});

/** How long a name the reader gives a session may be. */
export const MAX_SESSION_TITLE_LENGTH = 100;

/**
 * What renaming a session sends. Never empty: an untitled session is one
 * nobody has named, and taking a name away again is not something the screen
 * offers, so a blank one is a mistake rather than a request.
 */
export const renameSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(MAX_SESSION_TITLE_LENGTH),
});

export const sessionRenamedSchema = z.object({ id: z.string(), title: z.string() });

export const sessionDeletedSchema = z.object({ deleted: z.literal(true) });

/** The end of a conversation, cut short: enough to say what it was about. */
const lastMessageSchema = z.object({ role: chatRoleSchema, content: z.string() });

/**
 * One row of the chat list: a session of the book's own, or the conversation
 * hanging off a highlight. Highlights appear only once something was asked
 * about them — one that was only coloured has no conversation to list.
 *
 * `updatedAt` is when anything was last said (or, for a session nothing was
 * said in yet, when it was started), which is what the list is ordered by.
 */
export const chatSummarySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("book"),
    id: z.string(),
    title: z.string().nullable(),
    // The start of the first question, for the session nobody named.
    firstQuestion: z.string().nullable(),
    scope: z.array(pageRangeSchema).nullable(),
    messageCount: z.number().int().nonnegative(),
    lastMessage: lastMessageSchema.nullable(),
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("highlight"),
    // The highlight's id: its conversation has no id of its own.
    id: z.string(),
    selectedText: z.string(),
    pageNumber: z.number().int().positive(),
    color: z.string(),
    messageCount: z.number().int().positive(),
    lastMessage: lastMessageSchema,
    updatedAt: z.string(),
  }),
]);

export type ChatSummary = z.infer<typeof chatSummarySchema>;

export const chatListSchema = z.object({ chats: z.array(chatSummarySchema) });
