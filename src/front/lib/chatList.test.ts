import { describe, it, expect } from "vite-plus/test";
import {
  chatKind,
  chatTimeLabel,
  coversWholeBook,
  sessionTitle,
  titleFromQuestion,
} from "./chatList";
import { formatQuotedQuestion } from "./quotedQuestion";
import type { ChatSummary, PageRange } from "../../shared/schemas/chat";

describe("titleFromQuestion", () => {
  it("takes a short question whole, on one line", () => {
    expect(titleFromQuestion("この本の\n主張は?")).toBe("この本の 主張は?");
  });

  it("cuts a long one at 30 characters", () => {
    expect(titleFromQuestion("あ".repeat(40))).toBe(`${"あ".repeat(30)}…`);
  });

  it("names a question by what it asks rather than the passage quoted above it", () => {
    const question = formatQuotedQuestion("引用した回答の一節\n\n二行目", "これはどういう意味?");

    expect(titleFromQuestion(question)).toBe("これはどういう意味?");
  });

  it("falls back to the quote when that is all there is", () => {
    expect(titleFromQuestion("> 引用だけ")).toBe("引用だけ");
  });

  it("has nothing to offer for a blank question", () => {
    expect(titleFromQuestion("  \n ")).toBeNull();
  });
});

describe("sessionTitle", () => {
  it("prefers the name the reader gave", () => {
    expect(sessionTitle({ title: "第2章", firstQuestion: "要約して" })).toBe("第2章");
  });

  it("calls an unnamed session by its first question", () => {
    expect(sessionTitle({ title: null, firstQuestion: "要約して" })).toBe("要約して");
  });

  it("calls one nothing was asked in a new chat", () => {
    expect(sessionTitle({ title: null, firstQuestion: null })).toBe("新しいチャット");
  });
});

describe("chatKind", () => {
  const session = (scope: PageRange[] | null): ChatSummary => ({
    kind: "book",
    id: "s",
    title: null,
    firstQuestion: null,
    scope,
    messageCount: 0,
    lastMessage: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("calls a session asked about the whole book, or about nothing yet, the whole book", () => {
    expect(chatKind(session(null), 12)).toBe("本全体");
    expect(chatKind(session([{ startPage: 1, endPage: 12 }]), 12)).toBe("本全体");
  });

  it("calls one aimed at some chapters a range", () => {
    expect(
      chatKind(
        session([
          { startPage: 2, endPage: 4 },
          { startPage: 9, endPage: 12 },
        ]),
        12,
      ),
    ).toBe("範囲");
  });

  it("calls a highlight's conversation a highlight", () => {
    expect(
      chatKind(
        {
          kind: "highlight",
          id: "h",
          selectedText: "x",
          pageNumber: 1,
          color: "#FFEB3B",
          messageCount: 1,
          lastMessage: { role: "user", content: "?" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        12,
      ),
    ).toBe("ハイライト");
  });
});

describe("coversWholeBook", () => {
  it("reads a range past the last page as the whole of a book that shrank", () => {
    expect(coversWholeBook([{ startPage: 1, endPage: 20 }], 12)).toBe(true);
    expect(coversWholeBook([{ startPage: 2, endPage: 12 }], 12)).toBe(false);
  });
});

describe("chatTimeLabel", () => {
  const now = new Date(2026, 9, 4, 18, 30);

  it("gives the time for today", () => {
    expect(chatTimeLabel(new Date(2026, 9, 4, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("gives the month and day for earlier this year", () => {
    expect(chatTimeLabel(new Date(2026, 2, 7, 9, 5).toISOString(), now)).toBe("3/7");
  });

  it("gives the year too before that", () => {
    expect(chatTimeLabel(new Date(2025, 11, 31, 9, 5).toISOString(), now)).toBe("2025/12/31");
  });

  it("says nothing for a time it cannot read", () => {
    expect(chatTimeLabel("not a time", now)).toBe("");
  });
});
