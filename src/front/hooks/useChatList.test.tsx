import { describe, it, expect } from "vite-plus/test";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { errAsync, okAsync } from "neverthrow";
import { useChatList, type LoadChatList } from "./useChatList";
import { ApiError } from "../lib/fetcher";
import { SwrTestCache } from "../../test/swrTestCache";
import type { ChatSummary } from "../../shared/schemas/chat";

const PDF_ID = "book";

function session(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    kind: "book",
    id,
    title: null,
    firstQuestion: `${id} の質問`,
    scope: null,
    messageCount: 2,
    lastMessage: { role: "assistant", content: "答え" },
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as ChatSummary;
}

function wrapper({ children }: { children: ReactNode }) {
  return <SwrTestCache>{children}</SwrTestCache>;
}

describe("useChatList", () => {
  it("reads the book's conversations", async () => {
    const load: LoadChatList = async () => ({ chats: [session("s1")] });

    const { result } = renderHook(() => useChatList(PDF_ID, { load }), { wrapper });

    await waitFor(() => expect(result.current.chats.map((chat) => chat.id)).toStrictEqual(["s1"]));
    expect(result.current.loaded).toBe(true);
  });

  it("hands back why the list could not be read", async () => {
    const load: LoadChatList = async () => {
      throw new ApiError("boom", "INTERNAL_ERROR", 500);
    };

    const { result } = renderHook(() => useChatList(PDF_ID, { load }), { wrapper });

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.chats).toStrictEqual([]);
  });

  it("takes a deleted session out of the list once the server has dropped it", async () => {
    let reads = 0;
    const load: LoadChatList = async () => {
      reads += 1;
      return { chats: [session("s1"), session("s2")] };
    };
    const { result } = renderHook(
      () => useChatList(PDF_ID, { load, remove: () => okAsync({ deleted: true }) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.chats).toHaveLength(2));

    await act(async () => {
      await result.current.deleteSession(PDF_ID, "s1");
    });

    expect(result.current.chats.map((chat) => chat.id)).toStrictEqual(["s2"]);
    // Written from the answer, not read again.
    expect(reads).toBe(1);
  });

  it("keeps a session the server refused to delete, and says why", async () => {
    const load: LoadChatList = async () => ({ chats: [session("s1")] });
    const { result } = renderHook(
      () =>
        useChatList(PDF_ID, {
          load,
          remove: () => errAsync(new ApiError("refused", "INTERNAL_ERROR", 500)),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.chats).toHaveLength(1));

    let failure: string | undefined;
    await act(async () => {
      const removed = await result.current.deleteSession(PDF_ID, "s1");
      failure = removed.isErr() ? removed.error.message : undefined;
    });

    expect(failure).toBe("refused");
    expect(result.current.chats.map((chat) => chat.id)).toStrictEqual(["s1"]);
  });

  it("writes a new name into the list", async () => {
    const load: LoadChatList = async () => ({ chats: [session("s1")] });
    const { result } = renderHook(
      () =>
        useChatList(PDF_ID, {
          load,
          rename: (_pdfId, id, title) => okAsync({ id, title }),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.chats).toHaveLength(1));

    await act(async () => {
      await result.current.renameSession(PDF_ID, "s1", "第2章");
    });

    expect(result.current.chats[0]).toMatchObject({ id: "s1", title: "第2章" });
  });

  it("reads the list again once a session is started, to hold the row the server made", async () => {
    let reads = 0;
    const load: LoadChatList = async () => {
      reads += 1;
      return { chats: reads === 1 ? [] : [session("new")] };
    };
    const { result } = renderHook(
      () =>
        useChatList(PDF_ID, {
          load,
          create: () =>
            okAsync({
              id: "new",
              title: null,
              scope: null,
              createdAt: "2026-10-04T00:00:00.000Z",
              updatedAt: "2026-10-04T00:00:00.000Z",
            }),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.startSession(PDF_ID);
    });

    await waitFor(() => expect(result.current.chats.map((chat) => chat.id)).toStrictEqual(["new"]));
  });
});
