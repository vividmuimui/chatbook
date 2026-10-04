import type { ChatSummary, PageRange } from "../../shared/schemas/chat";

/** How much of a first question names a session nobody has named. */
export const SESSION_TITLE_LENGTH = 30;

/** What a chat about the book is called before anything is asked in it. */
export const NEW_CHAT_TITLE = "新しいチャット";

/**
 * The start of a question, as a name for the session it opened.
 *
 * A question asked about a passage of an answer carries that passage quoted
 * above it (`formatQuotedQuestion`); the quote is what the question is about,
 * not what it asks, so the name is taken from the lines after it. Whitespace —
 * line breaks included — runs together, since a name is one line.
 */
export function titleFromQuestion(question: string): string | null {
  const lines = question.split("\n");
  const oneLine = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  const asked = oneLine(lines.filter((line) => !line.startsWith(">")));
  // Only a quote and nothing after it: the quote is all there is to go by.
  const text = asked !== "" ? asked : oneLine(lines.map((line) => line.replace(/^>\s?/, "")));
  if (text === "") return null;
  return text.length <= SESSION_TITLE_LENGTH ? text : `${text.slice(0, SESSION_TITLE_LENGTH)}…`;
}

/** A session's name: the reader's, else its first question's, else that it is new. */
export function sessionTitle(session: { title: string | null; firstQuestion: string | null }) {
  return (
    session.title ??
    (session.firstQuestion === null ? null : titleFromQuestion(session.firstQuestion)) ??
    NEW_CHAT_TITLE
  );
}

/** Whether the pages a question was aimed at are the whole of a book this long. */
export function coversWholeBook(scope: PageRange[] | null, pageCount: number): boolean {
  if (scope === null || scope.length === 0) return true;
  return scope.some((range) => range.startPage <= 1 && range.endPage >= pageCount);
}

/** The mark that says what kind of conversation a row of the chat list is. */
export type ChatKind = "本全体" | "範囲" | "ハイライト";

export function chatKind(chat: ChatSummary, pageCount: number): ChatKind {
  if (chat.kind === "highlight") return "ハイライト";
  return coversWholeBook(chat.scope, pageCount) ? "本全体" : "範囲";
}

/**
 * When a conversation was last talked in, as short as a row can hold: the time
 * for today, the month and day for this year, the full date before that.
 */
export function chatTimeLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  if (at.toDateString() === now.toDateString()) {
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  if (at.getFullYear() === now.getFullYear()) return `${at.getMonth() + 1}/${at.getDate()}`;
  return `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()}`;
}
