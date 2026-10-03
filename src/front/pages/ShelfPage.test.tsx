import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { ShelfPage, type DeleteBook, type SetHidden } from "./ShelfPage";
import type { HiddenBooks } from "../../shared/schemas/shelf";
import { ApiError } from "../lib/fetcher";
import type { ExtractedPdfData } from "../lib/pdfLoader";
import type { BookSummary } from "../../shared/schemas/book";
import type { DropboxFile, DropboxFolderListing } from "../../shared/schemas/dropbox";
import type { DownloadDropboxFile } from "../lib/dropboxDownload";
import type { SaveDropboxFolder } from "../components/DropboxFolderDialog";
import { SwrTestCache } from "../../test/swrTestCache";
import { fakeUpload } from "../../test/fakeUpload";

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: "book-1",
    fileName: "Cloudflare Workers 入門.pdf",
    format: "pdf",
    pageCount: 209,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
    ...overrides,
  };
}

function renderShelf(props: {
  loadBooks?: () => Promise<BookSummary[]>;
  deleteBook?: DeleteBook;
  extract?: (file: File) => Promise<ExtractedPdfData>;
  createUploadRequest?: () => XMLHttpRequest;
  loadDropboxFolder?: () => Promise<DropboxFolderListing>;
  saveDropboxFolder?: SaveDropboxFolder;
  downloadDropbox?: DownloadDropboxFile;
  loadHidden?: () => Promise<HiddenBooks>;
  setHidden?: SetHidden;
}) {
  // A deploy without Dropbox unless the test says otherwise, so the shelf
  // never reaches for a real endpoint jsdom has no server behind.
  const withDropbox = {
    loadDropboxFolder: async (): Promise<DropboxFolderListing> => ({ state: "unavailable" }),
    loadHidden: async (): Promise<HiddenBooks> => ({ keys: [] }),
    ...props,
  };
  return render(
    <SwrTestCache>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ShelfPage {...withDropbox} />} />
          <Route path="/books/:pdfId" element={<ReaderStub />} />
        </Routes>
      </MemoryRouter>
    </SwrTestCache>,
  );
}

/** Stands in for the reader so navigation away from the shelf is observable. */
function ReaderStub() {
  return <p>リーダー: {useParams().pdfId}</p>;
}

/** Records the ids it was asked to delete so tests can assert on them. */
function recordingDeleter() {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    deleteBook: ((id: string) => {
      deletedIds.push(id);
      return okAsync({ deleted: true });
    }) satisfies DeleteBook,
  };
}

const TWO_BOOKS = async () => [book(), book({ id: "book-2", fileName: "Rust 入門.pdf" })];

const STORED_ID = "01JBOOK";

/** Reads a file the way pdf.js does when it can make sense of it. */
const readsFine = async (file: File): Promise<ExtractedPdfData> => ({
  fileName: file.name,
  fileHash: "sha256-of-the-file",
  fullText: "エッジはサーバーレス実行基盤です。",
  pageCount: 209,
  fileContentBase64: "",
  thumbnail: null,
  outline: null,
});

/** What the API answers a stored book with. */
const STORED_BOOK = {
  id: STORED_ID,
  fileName: "Cloudflare Workers.pdf",
  format: "pdf",
  pageCount: 209,
  fullText: "エッジはサーバーレス実行基盤です。",
  readingState: null,
};

/** Hands the hidden input a file, the way clicking the tile ends up doing. */
function chooseFile(container: HTMLElement, file: File) {
  return userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file);
}

const A_PDF = () => new File(["%PDF-1.7"], "Cloudflare Workers.pdf", { type: "application/pdf" });

/** What the browser puts on a drag that is carrying files. */
const carrying = (files: File[]) => ({ dataTransfer: { files, types: ["Files"] } });

const DROP_HINT = "ここにドロップして本を追加";

/** The shelf itself: where the books are, and what a drop is aimed at. */
const shelf = () => screen.getByRole("main");

describe("ShelfPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a card per book once the shelf has loaded", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });

    expect(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
  });

  it("counts an EPUB in chapters and a PDF in pages, without the file's extension", async () => {
    renderShelf({
      loadBooks: async () => [
        book({ id: "epub", fileName: "吾輩は猫である.epub", format: "epub", pageCount: 11 }),
        book({ id: "pdf", fileName: "Rust 入門.pdf", pageCount: 209 }),
      ],
    });

    expect(await screen.findByRole("button", { name: "吾輩は猫である を開く" })).toHaveTextContent(
      "11 章",
    );
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toHaveTextContent(
      "209 ページ",
    );
  });

  it("opens the reader for the book whose card was clicked", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });

    await userEvent.click(await screen.findByRole("button", { name: "Rust 入門 を開く" }));

    expect(await screen.findByText("リーダー: book-2")).toBeInTheDocument();
  });

  it("reports why the shelf is empty when loading fails", async () => {
    renderShelf({
      loadBooks: async () => {
        throw new Error("Network down");
      },
    });

    expect(
      await screen.findByText("本棚の読み込みに失敗しました: Network down"),
    ).toBeInTheDocument();
    // Adding a book does not go through the list, so a shelf that could not be
    // read is no reason to take the way in away with it.
    expect(screen.getByRole("button", { name: "本を追加" })).toBeEnabled();
  });

  it("deletes the book once the deletion is confirmed, and takes it off the shelf", async () => {
    const { deletedIds, deleteBook } = recordingDeleter();
    renderShelf({ loadBooks: TWO_BOOKS, deleteBook });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(deletedIds).toStrictEqual(["book-1"]);
    expect(
      screen.queryByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("warns that the highlights and chats go too when asked to delete a book", async () => {
    renderShelf({ loadBooks: TWO_BOOKS, deleteBook: recordingDeleter().deleteBook });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        "「Cloudflare Workers 入門」を削除しますか？ハイライトとチャット履歴も削除されます。",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the book when the deletion is cancelled", async () => {
    const { deletedIds, deleteBook } = recordingDeleter();
    renderShelf({ loadBooks: TWO_BOOKS, deleteBook });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(deletedIds).toStrictEqual([]);
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the book on the shelf and says why when the deletion fails", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      deleteBook: () => errAsync(new ApiError("Server exploded", "INTERNAL_ERROR", 500)),
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("削除に失敗しました: Server exploded")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("stays on the shelf and says why when a chosen file cannot be opened", async () => {
    // Choosing a PDF that fails used to leave the shelf exactly as it was, so
    // the reader had no way to tell it from a click that did not register.
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: () => Promise.reject(new Error("Invalid PDF structure")),
    });

    await screen.findByRole("button", { name: "本を追加" });
    await chooseFile(container, new File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));

    expect(
      await screen.findByText("本を開けませんでした: Invalid PDF structure"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    // The shelf is the reader's again: nothing is being read any more, so the
    // way to choose another file has to be back.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本を追加" })).toBeEnabled();
  });

  it("offers the way to add a book as the last cell of the shelf", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });

    await screen.findByRole("button", { name: "Rust 入門 を開く" });

    const cells = screen.getAllByRole("listitem");
    expect(cells).toHaveLength(3);
    expect(cells[2]).toContainElement(screen.getByRole("button", { name: "本を追加" }));
  });

  it("offers the same way, and says a file can be dropped, when the shelf is empty", async () => {
    renderShelf({ loadBooks: async () => [] });

    expect(await screen.findByRole("button", { name: "本を追加" })).toBeInTheDocument();
    expect(screen.getByText("まだ本がありません")).toBeInTheDocument();
    expect(
      screen.getByText("「本を追加」を押すか、PDFかEPUBのファイルをここにドロップしてください"),
    ).toBeInTheDocument();
  });

  it("opens the reader for a chosen file once it has been stored", async () => {
    const sending = fakeUpload();
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: readsFine,
      createUploadRequest: () => sending.request,
    });

    await screen.findByRole("button", { name: "本を追加" });
    await chooseFile(container, A_PDF());
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());
    act(() => {
      sending.answers(STORED_BOOK);
    });

    expect(await screen.findByText(`リーダー: ${STORED_ID}`)).toBeInTheDocument();
  });

  it("says a file can be dropped while one is dragged over the shelf, card or no card", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });
    const card = await screen.findByRole("button", { name: "Rust 入門 を開く" });
    expect(screen.queryByText(DROP_HINT)).not.toBeInTheDocument();

    fireEvent.dragEnter(shelf(), carrying([A_PDF()]));
    expect(screen.getByText(DROP_HINT)).toBeInTheDocument();

    // Passing over a book on the way is one leave and one enter. Counting only
    // the leaves would take the hint away halfway across the shelf.
    fireEvent.dragEnter(card, carrying([A_PDF()]));
    fireEvent.dragLeave(shelf(), carrying([A_PDF()]));

    expect(screen.getByText(DROP_HINT)).toBeInTheDocument();
  });

  it("takes the wording away once the drag has left the shelf", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });
    await screen.findByRole("button", { name: "本を追加" });
    expect(screen.queryByText(DROP_HINT)).not.toBeInTheDocument();

    fireEvent.dragEnter(shelf(), carrying([A_PDF()]));
    expect(screen.getByText(DROP_HINT)).toBeInTheDocument();

    fireEvent.dragLeave(shelf(), carrying([A_PDF()]));

    expect(screen.queryByText(DROP_HINT)).not.toBeInTheDocument();
  });

  it("opens the reader for a PDF dropped on the shelf", async () => {
    const sending = fakeUpload();
    renderShelf({
      loadBooks: TWO_BOOKS,
      extract: readsFine,
      createUploadRequest: () => sending.request,
    });
    await screen.findByRole("button", { name: "本を追加" });

    fireEvent.dragEnter(shelf(), carrying([A_PDF()]));
    fireEvent.drop(shelf(), carrying([A_PDF()]));
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());
    act(() => {
      sending.answers(STORED_BOOK);
    });

    expect(await screen.findByText(`リーダー: ${STORED_ID}`)).toBeInTheDocument();
  });

  it("says nothing while a drag that carries no file passes over the shelf", async () => {
    // Dragging a word out of a book's title is not an attempt to add a book,
    // and colouring the shelf for it would say the drop is going to work.
    renderShelf({ loadBooks: TWO_BOOKS });
    const tile = await screen.findByRole("button", { name: "本を追加" });

    fireEvent.dragEnter(shelf(), { dataTransfer: { files: [], types: ["text/plain"] } });

    expect(screen.queryByText(DROP_HINT)).not.toBeInTheDocument();
    expect(tile).toBeEnabled();
  });

  it("lets go of the drop the browser would otherwise open by itself", async () => {
    // An unprevented dragover hands the file to the browser, which navigates
    // away from the shelf and shows the PDF in its own viewer.
    renderShelf({ loadBooks: TWO_BOOKS });
    await screen.findByRole("button", { name: "本を追加" });

    // fireEvent reports back whether the default was left alone.
    expect(fireEvent.dragOver(shelf(), carrying([A_PDF()]))).toBe(false);
  });

  it("says why a drop that is not a single PDF was refused, and stays put", async () => {
    renderShelf({ loadBooks: TWO_BOOKS, extract: readsFine });
    await screen.findByRole("button", { name: "本を追加" });

    fireEvent.dragEnter(shelf(), carrying([A_PDF()]));
    expect(screen.getByText(DROP_HINT)).toBeInTheDocument();

    fireEvent.drop(shelf(), carrying([new File(["gif"], "cat.gif", { type: "image/gif" })]));

    expect(await screen.findByText("PDFかEPUBのファイルだけを追加できます")).toBeInTheDocument();
    // The shelf is handed back: a drop that was refused must not leave the
    // colouring over the books.
    expect(screen.queryByText(DROP_HINT)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
  });

  it("covers the shelf while the chosen file is being read", async () => {
    // Reading a 200-page book and uploading it takes long enough that a shelf
    // which said nothing looked like a click that had not registered.
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: () => new Promise<ExtractedPdfData>(() => {}),
    });

    await screen.findByRole("button", { name: "本を追加" });
    await chooseFile(container, A_PDF());

    expect(await screen.findByText("本を読み取り中...")).toBe(screen.getByRole("status"));
    // A second file while the first is in flight would open a book the reader
    // is already leaving the shelf for.
    expect(screen.getByRole("button", { name: "本を追加" })).toBeDisabled();
  });

  it("counts the book up as it is sent, and says so once it is all there", async () => {
    // A 22MB book takes about a minute to leave a phone. Without the share
    // going up, the same unchanging notice reads as a shelf that has hung.
    const sending = fakeUpload();
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: readsFine,
      createUploadRequest: () => sending.request,
    });

    await screen.findByRole("button", { name: "本を追加" });
    await chooseFile(container, A_PDF());
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());

    act(() => {
      sending.uploaded(1, 4);
    });
    expect(await screen.findByText("アップロード中 25%")).toBe(screen.getByRole("status"));

    act(() => {
      sending.uploaded(3, 4);
    });
    expect(await screen.findByText("アップロード中 75%")).toBeInTheDocument();

    // All of it is up and the server is writing it away: left at 100% the
    // notice would sit unchanged again for as long as that takes.
    act(() => {
      sending.uploaded(4, 4);
    });
    expect(await screen.findByText("保存中...")).toBeInTheDocument();
  });

  it("keeps the book when the confirmation is dismissed with Escape", async () => {
    const { deletedIds, deleteBook } = recordingDeleter();
    renderShelf({ loadBooks: TWO_BOOKS, deleteBook });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );
    await userEvent.keyboard("{Escape}");

    expect(deletedIds).toStrictEqual([]);
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the book when the click lands outside the confirmation", async () => {
    const { deletedIds, deleteBook } = recordingDeleter();
    renderShelf({ loadBooks: TWO_BOOKS, deleteBook });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );
    // The backdrop is the dialog's own wrapper; it has no role of its own
    await userEvent.click(screen.getByRole("alertdialog").parentElement!);

    expect(deletedIds).toStrictEqual([]);
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  describe("compact layout", () => {
    afterEach(() => localStorage.clear());

    it("lists the books as rows once the compact toggle is pressed, and keeps every action", async () => {
      const { deletedIds, deleteBook } = recordingDeleter();
      renderShelf({ loadBooks: TWO_BOOKS, deleteBook });

      const toggle = await screen.findByRole("button", { name: "コンパクト表示" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Rust 入門")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "本を追加" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Rust 入門 を削除" }));
      await userEvent.click(screen.getByRole("button", { name: "削除する" }));
      await waitFor(() => expect(deletedIds).toStrictEqual(["book-2"]));
    });

    it("opens the reader from a compact row", async () => {
      localStorage.setItem("chatbook:shelf-layout", JSON.stringify("compact"));
      renderShelf({ loadBooks: TWO_BOOKS });

      await userEvent.click(
        await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
      );

      expect(await screen.findByText("リーダー: book-1")).toBeInTheDocument();
    });
  });
});

const DROPBOX_BOOK: DropboxFile = {
  dropboxId: "id:zig",
  name: "Zig 入門.pdf",
  path: "/lang/Zig 入門.pdf",
  size: 1000,
};

const FOLDER_WITH_ONE_BOOK = async (): Promise<DropboxFolderListing> => ({
  state: "ready",
  folder: "/Books",
  files: [DROPBOX_BOOK],
});

/**
 * A download the test steps through: it reports the shares it is told to,
 * then hands back the file — or refuses.
 */
function steppedDownload() {
  let settle: (file: File) => void = () => {};
  let progress: (ratio: number) => void = () => {};
  const asked: DropboxFile[] = [];
  const download: DownloadDropboxFile = (file, onProgress) => {
    asked.push(file);
    progress = onProgress;
    return ResultAsync.fromSafePromise(
      new Promise<File>((resolve) => {
        settle = resolve;
      }),
    );
  };
  return {
    asked,
    download,
    reports: (ratio: number) => act(() => progress(ratio)),
    finishes: () =>
      act(() => settle(new File(["%PDF-1.7"], DROPBOX_BOOK.name, { type: "application/pdf" }))),
  };
}

describe("ShelfPage with Dropbox", () => {
  it("lines the folder's unread books up after the shelf's own", async () => {
    renderShelf({ loadBooks: TWO_BOOKS, loadDropboxFolder: FOLDER_WITH_ONE_BOOK });

    const card = await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" });
    expect(card).toHaveTextContent("/lang · 未読み込み");

    const cards = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(cards.indexOf("Rust 入門 を開く")).toBeLessThan(
      cards.indexOf("Zig 入門 を Dropbox から開く"),
    );
  });

  it("does not call a shelf empty while the folder has books in it", async () => {
    renderShelf({ loadBooks: async () => [], loadDropboxFolder: FOLDER_WITH_ONE_BOOK });

    await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" });
    expect(screen.queryByText("まだ本がありません")).not.toBeInTheDocument();
  });

  it("downloads, reads and stores a Dropbox book, then opens it", async () => {
    const fetching = steppedDownload();
    const sending = fakeUpload();
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
      downloadDropbox: fetching.download,
      extract: readsFine,
      createUploadRequest: () => sending.request,
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" }),
    );
    expect(fetching.asked).toStrictEqual([DROPBOX_BOOK]);
    fetching.reports(0.45);
    expect(screen.getByRole("status")).toHaveTextContent("Dropboxから取得中 45%");

    fetching.finishes();
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());
    // The server fetches the bytes from Dropbox itself; only the id goes up.
    const body = sending.sentBody() as FormData;
    expect(body.get("dropboxId")).toBe("id:zig");
    expect(body.get("file")).toBeNull();

    act(() => {
      sending.answers(STORED_BOOK);
    });
    expect(await screen.findByText(`リーダー: ${STORED_ID}`)).toBeInTheDocument();
  });

  it("stays on the shelf and says why when the download fails", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
      downloadDropbox: () => errAsync(new ApiError("Dropbox is down", "DROPBOX_ERROR", 502)),
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" }),
    );

    expect(
      await screen.findByText("Dropboxの本を開けませんでした: Dropbox is down"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the folder could not be read without taking the shelf down", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: async () => {
        throw new Error("No folder at /Books in Dropbox");
      },
    });

    expect(
      await screen.findByText(
        "Dropboxのフォルダを読めませんでした: No folder at /Books in Dropbox",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
    // Still the way to fix it.
    expect(screen.getByRole("button", { name: "Dropboxフォルダを設定" })).toBeInTheDocument();
  });

  it("offers no folder setting on a deploy without Dropbox", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });

    await screen.findByRole("button", { name: "Rust 入門 を開く" });
    expect(screen.queryByRole("button", { name: /Dropbox/ })).not.toBeInTheDocument();
  });

  it("saves the folder the reader types and reads it again", async () => {
    const saved: string[] = [];
    let listing: DropboxFolderListing = { state: "no-folder" };
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: async () => listing,
      saveDropboxFolder: (folder) => {
        saved.push(folder);
        listing = { state: "ready", folder: "/Books", files: [DROPBOX_BOOK] };
        return okAsync({ available: true, folder: "/Books" });
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Dropboxフォルダを設定" }));
    await userEvent.type(screen.getByRole("textbox"), "/Books");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(saved).toStrictEqual(["/Books"]);
    expect(await screen.findByRole("button", { name: "Dropbox: /Books" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" }),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open and says so when Dropbox has no such folder", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: async () => ({ state: "no-folder" }),
      saveDropboxFolder: () => errAsync(new ApiError("No folder", "DROPBOX_FOLDER_NOT_FOUND", 400)),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Dropboxフォルダを設定" }));
    await userEvent.type(screen.getByRole("textbox"), "/Typo");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("Dropbox にそのフォルダがありません")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tells the reader the Dropbox file stays when a Dropbox book is deleted", async () => {
    renderShelf({
      loadBooks: async () => [book({ inDropbox: true })],
      deleteBook: recordingDeleter().deleteBook,
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を削除" }),
    );

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Dropbox のファイルは削除されず、未読み込みの本として本棚に残ります。",
    );
  });
});

describe("ShelfPage: one entry per title", () => {
  const PDF_AND_EPUB = async () => [
    book({ id: "pdf-1", fileName: "Rust 入門.pdf" }),
    book({ id: "epub-1", fileName: "Rust 入門.epub", format: "epub", pageCount: 12 }),
  ];

  it("shows a PDF and an EPUB of the same name as one card, with a way into each", async () => {
    renderShelf({ loadBooks: PDF_AND_EPUB });

    await screen.findByRole("button", { name: "Rust 入門 を開く" });
    expect(screen.getAllByText("Rust 入門", { selector: "p" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Rust 入門 を EPUB で開く" }));
    expect(await screen.findByText("リーダー: epub-1")).toBeInTheDocument();
  });

  it("opens the PDF from the card itself", async () => {
    renderShelf({ loadBooks: PDF_AND_EPUB });

    await userEvent.click(await screen.findByRole("button", { name: "Rust 入門 を開く" }));

    expect(await screen.findByText("リーダー: pdf-1")).toBeInTheDocument();
  });

  it("joins a Dropbox file to the book that shares its name", async () => {
    renderShelf({
      loadBooks: async () => [book({ id: "pdf-1", fileName: "Rust 入門.pdf" })],
      loadDropboxFolder: async () => ({
        state: "ready",
        folder: "/books",
        files: [{ dropboxId: "id:e", name: "Rust 入門.epub", path: "/Rust 入門.epub", size: 1 }],
      }),
    });

    await screen.findByRole("button", { name: "Rust 入門 を開く" });
    expect(screen.getAllByText("Rust 入門", { selector: "p" })).toHaveLength(1);
    expect(
      await screen.findByRole("button", {
        name: /Rust 入門 を EPUB で開く（Dropbox・未読み込み）/,
      }),
    ).toBeInTheDocument();
  });

  it("deletes every book of the card once the reader agrees", async () => {
    const { deletedIds, deleteBook } = recordingDeleter();
    renderShelf({ loadBooks: PDF_AND_EPUB, deleteBook });

    await userEvent.click(await screen.findByRole("button", { name: "Rust 入門 を削除" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("PDF・EPUB");
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(deletedIds).toStrictEqual(["pdf-1", "epub-1"]));
  });
});

describe("ShelfPage: putting books away", () => {
  /** A store of what is hidden, answering the way the server does. */
  function hiddenStore(initial: string[] = []) {
    let keys = initial;
    const calls: { keys: string[]; hidden: boolean }[] = [];
    const setHidden: SetHidden = (changed, hidden) => {
      calls.push({ keys: changed, hidden });
      keys = hidden
        ? [...new Set([...keys, ...changed])]
        : keys.filter((k) => !changed.includes(k));
      return okAsync({ keys });
    };
    return { calls, setHidden, loadHidden: async () => ({ keys }) };
  }

  it("takes a card off the shelf, every file of it, and lists it under the hidden books", async () => {
    const store = hiddenStore();
    renderShelf({
      loadBooks: async () => [
        book({ id: "pdf-1", fileName: "Rust 入門.pdf" }),
        book({ id: "epub-1", fileName: "Rust 入門.epub", format: "epub" }),
        book({ id: "other", fileName: "Zig 入門.pdf" }),
      ],
      ...store,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Rust 入門 を非表示" }));

    expect(store.calls).toStrictEqual([{ keys: ["pdf-1", "epub-1"], hidden: true }]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Rust 入門 を開く" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Zig 入門 を開く" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "非表示の本 (1)" }));
    expect(screen.getByText("Rust 入門")).toBeInTheDocument();
  });

  it("starts without the books the server says are put away, Dropbox files included", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      loadDropboxFolder: async () => ({
        state: "ready",
        folder: "/books",
        files: [{ dropboxId: "id:zig", name: "Zig 入門.pdf", path: "/Zig 入門.pdf", size: 1 }],
      }),
      ...hiddenStore(["book-2", "id:zig"]),
    });

    await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" });
    expect(screen.queryByRole("button", { name: "Rust 入門 を開く" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zig 入門/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "非表示の本 (2)" })).toBeInTheDocument();
  });

  it("brings a book back to the shelf from the hidden list", async () => {
    const store = hiddenStore(["book-2"]);
    renderShelf({ loadBooks: TWO_BOOKS, ...store });

    await userEvent.click(await screen.findByRole("button", { name: "非表示の本 (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Rust 入門 を表示に戻す" }));

    expect(store.calls).toStrictEqual([{ keys: ["book-2"], hidden: false }]);
    expect(await screen.findByText("非表示の本はありません")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "非表示の本 (0)" }));
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
  });

  it("keeps the book on the shelf and says why when hiding fails", async () => {
    renderShelf({
      loadBooks: TWO_BOOKS,
      setHidden: () => errAsync(new ApiError("down", "INTERNAL_ERROR", 500, "http")),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Rust 入門 を非表示" }));

    expect(await screen.findByText(/非表示にすることに失敗しました: down/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
  });
});
