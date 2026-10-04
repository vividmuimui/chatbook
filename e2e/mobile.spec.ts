import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_FILE_NAME, OUTLINE, PAGE_COUNT, pageText } from "./fixtures/testBookManifest.ts";
import { EPUB_CHAPTERS, EPUB_FILE_NAME } from "./fixtures/testEpubManifest.ts";

/**
 * The reader on a screen with room for one column.
 *
 * Everything here is about what the width changes: the panes folding into a
 * page with a toolbar under it, and the gestures that replace a pointer. What
 * both layouts share — opening a book, drawing it, following a citation — is
 * covered once, against the panes, in `chatbook.spec.ts`.
 *
 * Not covered here: the pinch. Playwright drives one finger, and a gesture
 * needing two cannot be sent at all; `src/front/lib/touchNavigation.test.ts`
 * holds the arithmetic instead.
 */

const TEST_PDF = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  FIXTURE_FILE_NAME,
);

function pageLabel(pageNumber: number): string {
  return `${pageNumber} / ${PAGE_COUNT}`;
}

/** Upload the fixture book and land in the reader, with no highlights on it. */
/**
 * Sign in, so the rest of the run can reach the API.
 *
 * The credentials are the ones `.dev.vars` carries for local development; the
 * deployed app has a password of its own that never appears here.
 */
async function logIn(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "demo", password: "demo" },
  });
  expect(response.status()).toBe(200);
}

async function openTestBook(page: Page): Promise<string> {
  await logIn(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', TEST_PDF);
  await expect(page).toHaveURL(/\/books\//, { timeout: 60000 });

  const pdfId = new URL(page.url()).pathname.split("/").pop()!;
  const { selections, readingState, pageDirection } = (await (
    await page.request.get(`/api/pdf/${pdfId}`)
  ).json()) as {
    pageDirection: "ltr" | "rtl";
    selections: { id: string }[];
    readingState: {
      page: number;
      sessionId: string | null;
      outlineOpen: boolean | null;
      chatPanelOpen: boolean | null;
    } | null;
  };
  for (const selection of selections) {
    await page.request.delete(`/api/pdf/${pdfId}/selections/${selection.id}`);
  }
  // Chats about the book are the book's as well, and the chat list a test
  // reads would otherwise hold every session an earlier one started.
  const { chats } = (await (await page.request.get(`/api/pdf/${pdfId}/chats`)).json()) as {
    chats: { kind: string; id: string }[];
  };
  for (const chat of chats) {
    if (chat.kind === "book") await page.request.delete(`/api/pdf/${pdfId}/sessions/${chat.id}`);
  }

  // The three specs share this book, and the reader's place — both panels
  // included — is kept on the server now: uploading goes through the shelf,
  // which names no page, so an earlier test's place would be where this one
  // opens.
  await page.request.put(`/api/pdf/${pdfId}/reading-state`, {
    // `sessionId` is spelled out because leaving it out keeps whatever was
    // stored: a chat about the book, left open by an earlier test, would
    // otherwise be the one this one opens on.
    data: {
      page: 1,
      selectionId: null,
      sessionId: null,
      outlineOpen: true,
      chatPanelOpen: true,
    },
  });

  // The way the pages turn is the book's too, and a test that turned it to
  // open on the right would otherwise hand every later one a mirrored reader.
  await page.request.put(`/api/pdf/${pdfId}/page-direction`, {
    data: { pageDirection: "ltr" },
  });

  // Reload only where the reader is showing something the reset has just
  // replaced: a second load of the book costs as much as the first one.
  const resumedElsewhere =
    readingState !== null &&
    (readingState.page !== 1 ||
      readingState.sessionId !== null ||
      readingState.outlineOpen === false ||
      readingState.chatPanelOpen === false);
  if (
    selections.length > 0 ||
    chats.some((chat) => chat.kind === "book") ||
    resumedElsewhere ||
    pageDirection !== "ltr"
  ) {
    await page.goto(`/books/${pdfId}?page=1`);
  }
  // The page counter arrives with the book, but a tap or a drag needs the page
  // itself to have been drawn.
  await expect(page.getByText(pageLabel(1), { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator("canvas.block")).toBeVisible({ timeout: 60000 });
  return pdfId;
}

/** The pane the page is drawn and scrolled in. */
function pagePane(page: Page) {
  return page.locator("main .overflow-auto").first();
}

test("opens a book as one column, with the page controls under it", async ({ page }) => {
  await openTestBook(page);

  await expect(page.getByRole("navigation", { name: "ページ操作" })).toBeVisible();
  // The splitter sizes a second pane, and there is none
  await expect(page.getByRole("separator")).toHaveCount(0);
  // The page is drawn across the full width rather than shrunk to fit beside
  // something: it fills the window bar the pane's own padding.
  const pane = (await pagePane(page).boundingBox())!;
  // Waited for rather than read straight away: an unrendered canvas still has
  // a box, the 300x150 one every canvas starts with, and measuring that reads
  // as a page shrunk to a third of the window.
  const drawn = page.locator("main canvas").first();
  await expect
    .poll(async () => (await drawn.boundingBox())?.width ?? 0)
    .toBeGreaterThan(pane.width - 40);
});

test("turns the page on a tap at the edge, and leaves the middle alone", async ({ page }) => {
  await openTestBook(page);
  const pane = (await pagePane(page).boundingBox())!;
  const middleY = pane.y + pane.height / 2;

  await page.touchscreen.tap(pane.x + pane.width * 0.9, middleY);
  await expect(page.getByText(pageLabel(2), { exact: true })).toBeVisible();

  await page.touchscreen.tap(pane.x + pane.width * 0.1, middleY);
  await expect(page.getByText(pageLabel(1), { exact: true })).toBeVisible();

  // The middle belongs to the double tap that zooms, so one tap there does
  // nothing rather than turning the page under the reader's finger.
  await page.touchscreen.tap(pane.x + pane.width * 0.5, middleY);
  await expect(page.getByText(pageLabel(1), { exact: true })).toBeVisible();

  // Asserting page 1 straight after the middle tap would pass whether the tap
  // was ignored or had not been acted on yet. Turning the page from here says
  // which: a middle tap that had counted would land on 3 instead.
  await page.touchscreen.tap(pane.x + pane.width * 0.9, middleY);
  await expect(page.getByText(pageLabel(2), { exact: true })).toBeVisible();
});

test("brings the outline over the page, and jumps from it", async ({ page }) => {
  await openTestBook(page);
  const chapter = OUTLINE.find((entry) => entry.page > 1)!;

  await page.getByRole("button", { name: "目次", exact: true }).tap();
  await expect(page.getByRole("button", { name: "目次を閉じる" })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`^${chapter.title}`) }).tap();

  await expect(page.getByText(pageLabel(chapter.page), { exact: true })).toBeVisible();
  // Jumping is also leaving: the drawer covers the page it just moved to
  await expect(page.getByRole("button", { name: "目次を閉じる" })).toHaveCount(0);
});

test("raises the chat from the toolbar without taking the page turn away", async ({ page }) => {
  await openTestBook(page);

  await page.getByRole("button", { name: "チャット" }).tap();

  await expect(page.getByRole("region", { name: "チャット" })).toBeVisible();
  // The sheet stops above the toolbar, so reading on is still possible while
  // an answer is up — which is the point of having both on screen.
  await page.getByRole("button", { name: "次のページ" }).tap();
  await expect(page.getByText(pageLabel(2), { exact: true })).toBeVisible();
});

test("gives the answer the whole pane once the sheet is drawn all the way up", async ({ page }) => {
  await openTestBook(page);

  await page.getByRole("button", { name: "チャット" }).tap();
  const sheet = page.getByRole("region", { name: "チャット" });
  const pane = (await page.locator("main").boundingBox())!;
  expect((await sheet.boundingBox())!.height).toBeLessThan(pane.height * 0.6);

  await page.getByRole("button", { name: "チャットを広げる" }).tap();

  // Reading an answer through is what drawing the sheet up is for, and a strip
  // of the page above it is neither readable nor worth the lines of the answer
  // it costs.
  expect((await sheet.boundingBox())!.height).toBeCloseTo(pane.height, 0);
  // Still short of the toolbar, so the way on and the way back are both in reach
  await expect(page.getByRole("button", { name: "次のページ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "チャットを縮める" })).toBeVisible();
});

test("goes between the chats and the highlights inside the sheet, a tap each way", async ({
  page,
}) => {
  const pdfId = await openTestBook(page);
  const passage = pageText(2).body[0];
  await page.request.post(`/api/pdf/${pdfId}/selections`, {
    data: {
      selectedText: passage,
      pageNumber: 2,
      positionData: { rects: [{ x: 40, y: 40, width: 160, height: 24 }] },
    },
  });
  await page.reload();

  await page.getByRole("button", { name: "チャット" }).tap({ timeout: 60000 });
  const sheet = page.getByRole("region", { name: "チャット" });
  await expect(sheet.getByText("ハイライト 1件")).toBeVisible();

  await sheet.getByRole("tab", { name: "チャット" }).tap();
  await expect(sheet.getByRole("button", { name: "新しいチャット", exact: true })).toBeVisible();
  await expect(sheet.getByText("ハイライト 1件")).toBeHidden();

  await sheet.getByRole("tab", { name: "ハイライト" }).tap();
  await expect(sheet.getByText("ハイライト 1件")).toBeVisible();

  // The highlight's conversation is the button beside it, and the way back
  // comes to the list it was opened from
  await sheet
    .getByRole("listitem")
    .filter({ hasText: passage })
    .getByRole("button", { name: /のチャットを開く$/ })
    .tap();
  await expect(sheet.getByPlaceholder("質問を入力...")).toBeVisible();
  await sheet.getByRole("button", { name: "一覧に戻る" }).tap();
  await expect(sheet.getByText("ハイライト 1件")).toBeVisible();
});

// What the desktop spec's test of the same name does not cover: this one is
// about the sheet, since what is drawn half way up a phone is the least room
// the chapter menu will ever be given. Nothing here is sent, so no model is
// asked for an answer.
test("asks the book itself from the sheet, with the chapters within reach of it", async ({
  page,
}) => {
  await openTestBook(page);

  await page.getByRole("button", { name: "チャット" }).tap();
  const sheet = page.getByRole("region", { name: "チャット" });
  await sheet.getByRole("tab", { name: "チャット" }).tap();
  await sheet.getByRole("button", { name: "新しいチャット", exact: true }).tap();

  // Opened from the sheet, the conversation takes it over rather than a second
  // one being drawn: the toolbar's chat button is still the way back.
  await expect(sheet.getByRole("button", { name: "範囲: 本全体" })).toBeVisible();

  await sheet.getByRole("button", { name: "範囲: 本全体" }).tap();
  const sheetBox = (await sheet.boundingBox())!;
  const lastChapter = (await sheet.getByText("9〜12ページ").boundingBox())!;
  expect(lastChapter.y + lastChapter.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height);

  await sheet.getByRole("checkbox", { name: /第1章 テキストレイヤーの検証/ }).tap();
  await expect(
    sheet.getByRole("button", { name: "範囲: 第1章 テキストレイヤーの検証" }),
  ).toBeVisible();
});

test("offers to ask about a passage, and puts the question box up on request", async ({ page }) => {
  await openTestBook(page);

  // A drag over a line is what a long press settles into; the viewer reads it
  // from the browser announcing the selection rather than from a mouse button.
  const line = page.locator(".textLayer span").first();
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const ask = page.getByRole("button", { name: "AIに質問" });
  await expect(ask).toBeVisible({ timeout: 10000 });
  // The passage is quoted back, where a selection off by a word shows up
  // before a highlight is stored from it
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected.trim().length).toBeGreaterThan(0);

  // The keyboard only arrives once the offer is taken
  await expect(page.getByPlaceholder("選択した文章について質問する...")).toHaveCount(0);
  await ask.tap();
  await expect(page.getByPlaceholder("選択した文章について質問する...")).toBeVisible();
});

test("keeps the shelf shut until the password is typed", async ({ page }) => {
  // The whole reason this is deployed behind a login: the URL is public, and
  // what is behind it — the books, and the API key the answers cost — is not.
  const refused = await page.request.get("/api/pdfs", { failOnStatusCode: false });
  expect(refused.status()).toBe(401);

  await page.goto("/");
  await expect(page.getByLabel("パスワード")).toBeVisible();

  await page.getByLabel("ユーザー名").fill("demo");
  await page.getByLabel("パスワード").fill("demo");
  await page.getByRole("button", { name: "ログイン" }).tap();

  // Signed in, and still at the address that was asked for
  await expect(page.getByRole("button", { name: "本を追加" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

const TEST_EPUB = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  EPUB_FILE_NAME,
);

test("turns an EPUB a screen at a time at the edges and with a swipe", async ({ page }) => {
  await logIn(page);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', TEST_EPUB);
  await expect(page).toHaveURL(/\/books\//, { timeout: 60000 });

  // The second chapter, which fills several screens of a phone
  const bookId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/books/${bookId}?page=2`);
  const chapters = EPUB_CHAPTERS.length;
  await expect(page.getByText(`2 / ${chapters} 章`, { exact: true })).toBeVisible();
  const screenLabel = page.getByText(/^\d+ \/ \d+$/);
  await expect(screenLabel).toHaveText(/^1 \//);
  // Waited for, not read once: the chapter counts as one screen until it has
  // been laid out, and "1 / 1" would otherwise be taken for the whole of it.
  const screenCount = async () => Number((await screenLabel.textContent())!.split("/")[1]);
  await expect.poll(screenCount).toBeGreaterThan(2);
  const count = await screenCount();

  const paper = (await page.locator("article").boundingBox())!;
  const middleY = paper.y + paper.height / 2;

  await page.touchscreen.tap(paper.x + paper.width * 0.9, middleY);
  await expect(screenLabel).toHaveText(`2 / ${count}`);
  await page.touchscreen.tap(paper.x + paper.width * 0.1, middleY);
  await expect(screenLabel).toHaveText(`1 / ${count}`);
  await page.touchscreen.tap(paper.x + paper.width * 0.5, middleY);
  await expect(screenLabel).toHaveText(`1 / ${count}`);

  // A finger flicked from right to left reads on, as it turns a PDF page.
  // Real touches, so the gesture arrives as the browser would deliver it.
  const touch = await page.context().newCDPSession(page);
  const from = paper.x + paper.width * 0.7;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from, y: middleY }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: from - 80, y: middleY }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: from - 160, y: middleY }],
  });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(screenLabel).toHaveText(`2 / ${count}`);
  // The chapter's opening is a screen behind now, not merely renumbered
  await expect(
    page.locator(".epubChapter p", { hasText: EPUB_CHAPTERS[1].paragraphs[0] }),
  ).not.toBeInViewport();
});
