import { atom } from "jotai";
import type { ChatMessage, PageRange } from "../../shared/schemas/chat";

/** The highlighted passage the current conversation is about. */
export interface ActiveSelection {
  id: string;
  selectedText: string;
  pageNumber: number;
}

export const activeSelectionAtom = atom<ActiveSelection | null>(null);

/**
 * The chat about the book that is open, if one is: a session of the book's own
 * rather than a highlight's conversation.
 *
 * A book holds any number of these — the reader starts a new one for something
 * unrelated rather than piling every question into one thread. `id` is null
 * for a new chat nothing has been asked in yet: the server only makes the
 * session when the first question is sent (`sessionStartedAtom`), so a chat
 * opened and left empty leaves nothing behind. Its title and what was said are
 * not here — the title is the chat list's (SWR), the thread is
 * `chatMessagesAtom`.
 */
export interface OpenSession {
  id: string | null;
}

export const activeSessionAtom = atom<OpenSession | null>(null);

/**
 * The pages the next question about the book is aimed at, as the ranges the
 * server cuts an excerpt by. Empty is the whole book.
 *
 * Held per session: opening one puts back the pages its last question was
 * aimed at (the server keeps them with the session), and a new chat starts on
 * the whole book. Ranges rather than chapters, so a session can be reopened on
 * its pages before the chapter list has arrived; the scope menu finds its
 * chapters among them by their pages.
 */
export const chatScopeAtom = atom<PageRange[]>([]);

/** Which of the panel's three faces is on screen. */
export type ChatFace = "list" | "highlight" | "book";

/**
 * The face the panel shows, derived so the three cannot disagree.
 *
 * `openChat` and `openSession` each clear the other, but the highlight wins
 * here as well: it is the narrower request, the one the reader made most
 * recently, and having it lose would show a thread about the book under a
 * passage they had just picked out.
 */
export const chatFaceAtom = atom<ChatFace>((get) =>
  get(activeSelectionAtom) !== null
    ? "highlight"
    : get(activeSessionAtom) !== null
      ? "book"
      : "list",
);

/** Which list the panel shows while no conversation is open. */
export type ChatListTab = "chats" | "highlights";

/**
 * The list on screen: every conversation the book holds, or every highlight.
 *
 * Two ways in rather than one list inside the other — a highlight is a mark on
 * the page whether or not anything was asked about it, and a chat about the
 * whole book has no passage to hang in a list of passages. Starts on the
 * highlights, which is what the panel always opened on; kept in the book's
 * store only, so "← 一覧に戻る" comes back to the list the reader left.
 */
export const chatListTabAtom = atom<ChatListTab>("highlights");

/**
 * Whether the panel on the right — the highlight list, or a chat — is showing.
 *
 * Away until the book says otherwise, the same way the outline starts
 * (`outlineOpenAtom`): `useReadingLocation` puts it up as soon as the book
 * arrives, unless the book was left with it folded away.
 */
export const chatPanelOpenAtom = atom<boolean>(false);

/** How far the chat is drawn up over the page on a screen with room for one column. */
export type ChatSheetState = "closed" | "half" | "full";

/**
 * The sheet's own state, kept apart from `chatPanelOpenAtom` and off the server.
 *
 * The panel and the sheet answer different questions. The panel says whether a
 * reader on a wide screen folded the conversation away, which is saved with the
 * book so a laptop reopens it that way. A phone always starts on the book —
 * there is no second pane to have left open — so beginning at `closed` is not a
 * state worth carrying between devices, and half versus full is a gesture
 * rather than a place to return to.
 */
export const chatSheetAtom = atom<ChatSheetState>("closed");

/**
 * Whether the chat has been given the whole window, with the page put away
 * behind it.
 *
 * Off the server, unlike `chatPanelOpenAtom`: this is a way of reading one
 * answer through rather than how the reader keeps this book, so a reload comes
 * back to the two panes. The store is rebuilt per book (`AppPage` keys its
 * `Provider` on the id), so opening another book starts on the page as well.
 *
 * Only meaningful while the panel is open — folding the chat away clears it.
 */
export const chatMaximizedAtom = atom<boolean>(false);

export const chatMessagesAtom = atom<ChatMessage[]>([]);
export const streamingContentAtom = atom<string>("");
export const isStreamingAtom = atom<boolean>(false);

/**
 * What went wrong with this conversation, worded for the reader, or null when
 * nothing has.
 *
 * The panel reads this and nothing else: `sendMessage` also hands its failure
 * back so a caller can decide what to do next, but a caller that ignores the
 * return value still cannot leave the reader staring at an unanswered
 * question. Whoever writes here words the message, since "the answer never
 * came" and "the history could not be read" are not the same sentence.
 */
export const chatErrorAtom = atom<string | null>(null);

/** Shared, so leaving a chat can stop an answer any of the panels started. */
export const chatAbortControllerAtom = atom<AbortController | null>(null);

/**
 * Stop the answer being streamed and put the chat back at rest.
 *
 * The tidy-up lives here rather than in the stream's own cleanup so that
 * starting the next answer straight after cannot be undone by the old one
 * finishing a moment later.
 */
export const abortChatStreamAtom = atom(null, (get, set) => {
  const controller = get(chatAbortControllerAtom);
  if (!controller) return;

  controller.abort();
  set(chatAbortControllerAtom, null);
  set(isStreamingAtom, false);
  set(streamingContentAtom, "");
});

/**
 * Leave the chat of a highlight the server has just dropped.
 *
 * Written as an atom rather than a check inside whoever asked for the deletion,
 * because the reader can open a chat while the request is in flight: a handler
 * comparing the selection it captured when it rendered would be looking at a
 * chat that has since been replaced. Reading the store as the answer lands is
 * the only way to see which chat is open by then.
 *
 * Emptying `activeSelectionAtom` is also what takes `?selection=` out of the
 * address and off the reading position, since both follow this atom.
 */
export const selectionDeletedAtom = atom(null, (get, set, deletedId: string) => {
  if (get(activeSelectionAtom)?.id !== deletedId) return;

  set(abortChatStreamAtom);
  set(activeSelectionAtom, null);
});

/**
 * Name the new chat the reader is in after the server has made its session.
 *
 * Answers whether it did: the reader may have gone back to the list, or into
 * another chat, while the session was being made, and the question that made
 * it then belongs to a chat no longer on screen — the caller does not send it.
 */
export const sessionStartedAtom = atom(null, (get, set, sessionId: string): boolean => {
  const open = get(activeSessionAtom);
  if (open === null || open.id !== null) return false;

  set(activeSessionAtom, { id: sessionId });
  return true;
});

/**
 * Leave a chat about the book the server has just deleted, read off the store
 * as the answer lands for the same reason as `selectionDeletedAtom`.
 */
export const sessionDeletedAtom = atom(null, (get, set, deletedId: string) => {
  if (get(activeSessionAtom)?.id !== deletedId) return;

  set(abortChatStreamAtom);
  set(activeSessionAtom, null);
});
