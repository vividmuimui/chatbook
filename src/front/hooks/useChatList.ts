import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ResultAsync } from "neverthrow";
import { fetcher, resultFetcher, type ApiError } from "../lib/fetcher";
import {
  chatListSchema,
  chatSessionSchema,
  sessionDeletedSchema,
  sessionRenamedSchema,
  type ChatSession,
  type ChatSummary,
} from "../../shared/schemas/chat";

/** Where a book's chat list is read from, and the key it is cached under. */
export const chatListKey = (pdfId: string) => `/api/pdf/${pdfId}/chats`;

/** Reads every conversation a book holds. */
export type LoadChatList = (pdfId: string) => Promise<{ chats: ChatSummary[] }>;

export const fetchChatList: LoadChatList = (pdfId) => fetcher(chatListKey(pdfId), chatListSchema);

/** Starts a session on the book. A write, so its failure comes back in the value. */
export type CreateSession = (pdfId: string) => ResultAsync<ChatSession, ApiError>;

const requestNewSession: CreateSession = (pdfId) =>
  resultFetcher(`/api/pdf/${pdfId}/sessions`, chatSessionSchema, { method: "POST" });

/** Deletes a session and what was said in it. */
export type DeleteSession = (pdfId: string, sessionId: string) => ResultAsync<unknown, ApiError>;

const requestSessionDeletion: DeleteSession = (pdfId, sessionId) =>
  resultFetcher(`/api/pdf/${pdfId}/sessions/${sessionId}`, sessionDeletedSchema, {
    method: "DELETE",
  });

/** Names a session. */
export type RenameSession = (
  pdfId: string,
  sessionId: string,
  title: string,
) => ResultAsync<{ id: string; title: string }, ApiError>;

const requestSessionRename: RenameSession = (pdfId, sessionId, title) =>
  resultFetcher(`/api/pdf/${pdfId}/sessions/${sessionId}`, sessionRenamedSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

/** The ways in to the server this hook goes through; each is swappable in a test. */
export interface ChatListRequests {
  load?: LoadChatList;
  create?: CreateSession;
  remove?: DeleteSession;
  rename?: RenameSession;
}

const NO_CHATS: ChatSummary[] = [];

/**
 * The book's chat list — its own sessions and the highlights something was
 * asked about — and the writes that change it.
 *
 * On SWR like the book: the list is on screen for as long as the panel shows
 * it, and is changed by things other than this hook (a question asked anywhere
 * moves its conversation to the top, which `useChatStream` sees to). Deleting
 * and renaming write what the server answered into the list rather than
 * reading it again; starting a session reads it again, since the server has
 * just made a row the list has never seen.
 */
export function useChatList(pdfId: string | undefined, requests: ChatListRequests = {}) {
  const {
    load = fetchChatList,
    create = requestNewSession,
    remove = requestSessionDeletion,
    rename = requestSessionRename,
  } = requests;
  const { mutate } = useSWRConfig();
  const key = pdfId ? chatListKey(pdfId) : null;
  const { data, error } = useSWR(key, () => load(pdfId as string));

  /** Read the list again, for a change made somewhere this hook cannot see. */
  const refresh = useCallback(() => {
    if (key !== null) void mutate(key);
  }, [key, mutate]);

  const startSession = useCallback(
    (bookId: string): ResultAsync<ChatSession, ApiError> =>
      create(bookId).andTee(() => void mutate(chatListKey(bookId))),
    [create, mutate],
  );

  const deleteSession = useCallback(
    (bookId: string, sessionId: string): ResultAsync<void, ApiError> =>
      remove(bookId, sessionId).map(() => {
        void mutate(
          chatListKey(bookId),
          (current: { chats: ChatSummary[] } | undefined) =>
            current && {
              chats: current.chats.filter(
                (chat) => !(chat.kind === "book" && chat.id === sessionId),
              ),
            },
          { revalidate: false },
        );
      }),
    [remove, mutate],
  );

  const renameSession = useCallback(
    (bookId: string, sessionId: string, title: string): ResultAsync<void, ApiError> =>
      rename(bookId, sessionId, title).map((renamed) => {
        void mutate(
          chatListKey(bookId),
          (current: { chats: ChatSummary[] } | undefined) =>
            current && {
              chats: current.chats.map((chat) =>
                chat.kind === "book" && chat.id === renamed.id
                  ? { ...chat, title: renamed.title }
                  : chat,
              ),
            },
          { revalidate: false },
        );
      }),
    [rename, mutate],
  );

  return {
    chats: data?.chats ?? NO_CHATS,
    loaded: data !== undefined,
    error: error as Error | undefined,
    refresh,
    startSession,
    deleteSession,
    renameSession,
  };
}
