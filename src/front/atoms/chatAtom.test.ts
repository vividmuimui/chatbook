import { describe, it, expect } from "vite-plus/test";
import { createStore } from "jotai";
import {
  abortChatStreamAtom,
  activeSelectionAtom,
  activeSessionAtom,
  chatAbortControllerAtom,
  chatFaceAtom,
  isStreamingAtom,
  selectionDeletedAtom,
  sessionDeletedAtom,
  sessionStartedAtom,
  streamingContentAtom,
  type ActiveSelection,
} from "./chatAtom";

const OPEN_CHAT: ActiveSelection = {
  id: "01JOPEN",
  selectedText: "KV は結果整合です。",
  pageNumber: 42,
};

describe("abortChatStreamAtom", () => {
  it("stops the running answer and clears what it was drawing", () => {
    const store = createStore();
    const controller = new AbortController();
    store.set(chatAbortControllerAtom, controller);
    store.set(isStreamingAtom, true);
    store.set(streamingContentAtom, "Durable Objects は");

    store.set(abortChatStreamAtom);

    expect(controller.signal.aborted).toBe(true);
    expect(store.get(chatAbortControllerAtom)).toBeNull();
    expect(store.get(isStreamingAtom)).toBe(false);
    expect(store.get(streamingContentAtom)).toBe("");
  });

  it("leaves the chat untouched when the answer it stopped is already gone", () => {
    const store = createStore();
    const controller = new AbortController();
    store.set(chatAbortControllerAtom, controller);
    store.set(streamingContentAtom, "Durable Objects は");

    store.set(abortChatStreamAtom);
    expect(controller.signal.aborted).toBe(true);
    expect(store.get(streamingContentAtom)).toBe("");

    // What the chat shows next is no longer the stopped answer's to clear
    store.set(streamingContentAtom, "次の回答の書き出し");
    store.set(abortChatStreamAtom);

    expect(store.get(streamingContentAtom)).toBe("次の回答の書き出し");
  });
});

describe("chatFaceAtom", () => {
  it("shows the list while neither a highlight nor a chat about the book is open", () => {
    const store = createStore();

    expect(store.get(chatFaceAtom)).toBe("list");
  });

  it("shows a chat about the book once it is the one that was opened, saved or not", () => {
    const store = createStore();
    store.set(activeSessionAtom, { id: null });

    expect(store.get(chatFaceAtom)).toBe("book");

    store.set(activeSessionAtom, { id: "01JSESSION" });

    expect(store.get(chatFaceAtom)).toBe("book");
  });

  it("shows the highlight's conversation over the book's when both are open", () => {
    const store = createStore();
    store.set(activeSelectionAtom, OPEN_CHAT);
    store.set(activeSessionAtom, { id: "01JSESSION" });

    expect(store.get(chatFaceAtom)).toBe("highlight");
  });
});

describe("selectionDeletedAtom", () => {
  it("leaves the chat of a highlight that has just been deleted", () => {
    const store = createStore();
    const controller = new AbortController();
    store.set(activeSelectionAtom, OPEN_CHAT);
    store.set(chatAbortControllerAtom, controller);
    store.set(isStreamingAtom, true);

    store.set(selectionDeletedAtom, OPEN_CHAT.id);

    expect(store.get(activeSelectionAtom)).toBeNull();
    expect(controller.signal.aborted).toBe(true);
    expect(store.get(isStreamingAtom)).toBe(false);
  });

  it("keeps the open chat when some other highlight was the one deleted", () => {
    const store = createStore();
    const controller = new AbortController();
    store.set(activeSelectionAtom, OPEN_CHAT);
    store.set(chatAbortControllerAtom, controller);
    store.set(isStreamingAtom, true);

    store.set(selectionDeletedAtom, "01JOTHER");

    expect(store.get(activeSelectionAtom)).toStrictEqual(OPEN_CHAT);
    expect(controller.signal.aborted).toBe(false);
    expect(store.get(isStreamingAtom)).toBe(true);

    // The same chat does leave once it is the one deleted, so what stood above
    // is the guard holding rather than the atom never doing anything.
    store.set(selectionDeletedAtom, OPEN_CHAT.id);

    expect(store.get(activeSelectionAtom)).toBeNull();
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("sessionStartedAtom", () => {
  it("names the new chat the reader is still in once the server has made it", () => {
    const store = createStore();
    store.set(activeSessionAtom, { id: null });

    expect(store.set(sessionStartedAtom, "01JNEW")).toBe(true);

    expect(store.get(activeSessionAtom)).toStrictEqual({ id: "01JNEW" });
  });

  it("leaves alone a reader who has moved on while the chat was being made", () => {
    // They went back to the list, or opened another chat: the question that
    // made this session was for a chat no longer on screen.
    const store = createStore();
    store.set(activeSessionAtom, { id: "01JOTHER" });

    expect(store.set(sessionStartedAtom, "01JNEW")).toBe(false);
    expect(store.get(activeSessionAtom)).toStrictEqual({ id: "01JOTHER" });

    store.set(activeSessionAtom, null);
    expect(store.set(sessionStartedAtom, "01JNEW")).toBe(false);
    expect(store.get(activeSessionAtom)).toBeNull();
  });
});

describe("sessionDeletedAtom", () => {
  it("leaves the chat that has just been deleted, and no other", () => {
    const store = createStore();
    const controller = new AbortController();
    store.set(activeSessionAtom, { id: "01JOPEN" });
    store.set(chatAbortControllerAtom, controller);
    store.set(isStreamingAtom, true);

    store.set(sessionDeletedAtom, "01JOTHER");
    expect(store.get(activeSessionAtom)).toStrictEqual({ id: "01JOPEN" });
    expect(controller.signal.aborted).toBe(false);

    store.set(sessionDeletedAtom, "01JOPEN");
    expect(store.get(activeSessionAtom)).toBeNull();
    expect(controller.signal.aborted).toBe(true);
  });
});
