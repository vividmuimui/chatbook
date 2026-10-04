import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import {
  ShelfPage,
  type DeleteBook,
  type RenameBook,
  type SetDropboxTitles,
  type SetHidden,
} from "./ShelfPage";
import type { Collection, DropboxTitles, HiddenBooks } from "../../shared/schemas/shelf";
import type { CollectionsApi } from "../lib/collectionsApi";
import { ApiError } from "../lib/fetcher";
import type { ExtractedPdfData } from "../lib/pdfLoader";
import { createOcrQueue } from "../lib/ocrQueue";
import type { ReadStoredBookByOcr, SaveOcr } from "../hooks/useBackgroundOcr";
import type { BookDetail, BookSummary } from "../../shared/schemas/book";
import { useSWRConfig } from "swr";
import { bookKey } from "../hooks/useBook";
import type { DropboxFile, DropboxFolderListing } from "../../shared/schemas/dropbox";
import type { DownloadDropboxFile } from "../lib/dropboxDownload";
import type { SaveDropboxFolder } from "../components/DropboxFolderDialog";
import { SwrTestCache } from "../../test/swrTestCache";
import { fakeUpload } from "../../test/fakeUpload";

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    title: null,
    id: "book-1",
    fileName: "Cloudflare Workers 入門.pdf",
    format: "pdf",
    pageCount: 209,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
    lastReadPage: null,
    ...overrides,
  };
}

/**
 * The reader's collections, kept and answered the way the server does: every
 * write answers with every collection. `fail` makes the writes refuse.
 */
function collectionStore(initial: Collection[] = [], fail = false) {
  let collections = initial;
  let nextId = 1;
  const calls: string[] = [];
  const answer = () => okAsync({ collections });
  const refuse = () => errAsync(new ApiError("down", "INTERNAL_ERROR", 500, "http"));
  const api: CollectionsApi = {
    load: async () => ({ collections }),
    create: (name, keys = []) => {
      calls.push(`create ${name} [${keys.join(",")}]`);
      if (fail) return refuse();
      collections = [...collections, collectionOf(`c${nextId++}`, name, keys)];
      return answer();
    },
    rename: (id, name) => {
      calls.push(`rename ${id} ${name}`);
      if (fail) return refuse();
      collections = collections.map((c) => (c.id === id ? { ...c, name } : c));
      return answer();
    },
    remove: (id) => {
      calls.push(`remove ${id}`);
      if (fail) return refuse();
      collections = collections.filter((c) => c.id !== id);
      return answer();
    },
    setItems: (id, keys, member) => {
      calls.push(`${member ? "add" : "take"} ${id} [${keys.join(",")}]`);
      if (fail) return refuse();
      collections = collections.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              keys: member
                ? [...new Set([...c.keys, ...keys])]
                : c.keys.filter((k) => !keys.includes(k)),
            },
      );
      return answer();
    },
  };
  return { api, calls, current: () => collections };
}

function collectionOf(id: string, name: string, keys: string[] = []): Collection {
  return { id, name, keys, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
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
  renameBook?: RenameBook;
  loadDropboxTitles?: () => Promise<DropboxTitles>;
  setDropboxTitles?: SetDropboxTitles;
  readByOcr?: ReadStoredBookByOcr;
  saveOcr?: SaveOcr;
  collections?: CollectionsApi;
  /** Where the shelf is opened, `?collection=` and all. */
  initialEntry?: string;
  /** Entries already in the cache, standing in for what the server answered before. */
  seed?: Record<string, unknown>;
}) {
  // A deploy without Dropbox unless the test says otherwise, so the shelf
  // never reaches for a real endpoint jsdom has no server behind.
  const withDropbox = {
    loadDropboxFolder: async (): Promise<DropboxFolderListing> => ({ state: "unavailable" }),
    loadHidden: async (): Promise<HiddenBooks> => ({ keys: [] }),
    loadDropboxTitles: async (): Promise<DropboxTitles> => ({ titles: [] }),
    ocrQueue: createOcrQueue(),
    collections: collectionStore().api,
    ...props,
  };
  return render(
    <SwrTestCache seed={props.seed}>
      <MemoryRouter initialEntries={[props.initialEntry ?? "/"]}>
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
  const pdfId = useParams().pdfId!;
  // What the reader would head the page with, read from the cache it shares.
  const cached = useSWRConfig().cache.get(bookKey(pdfId))?.data as BookDetail | undefined;
  return (
    <>
      <p>リーダー: {pdfId}</p>
      {cached && <p>題名: {cached.title ?? "なし"}</p>}
    </>
  );
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

/**
 * Opens an entry's 「…」 sheet and hands back the action named — renaming,
 * filing in collections and hiding wait there, under the entry's title.
 */
async function entryAction(name: string) {
  const title = name.replace(/ (を非表示|の題名を変更|のコレクションを選ぶ)$/, "");
  await userEvent.click(await screen.findByRole("button", { name: `${title} のその他の操作` }));
  return within(screen.getByRole("dialog", { name: `${title} の操作` })).getByRole("button", {
    name,
  });
}

/** Opens the shelf's settings, where the folder and the preferred format are chosen. */
async function openShelfSettings() {
  await userEvent.click(await screen.findByRole("button", { name: "設定" }));
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
  needsOcr: false,
});

/** What the API answers a stored book with. */
const STORED_BOOK = {
  id: STORED_ID,
  fileName: "Cloudflare Workers.pdf",
  format: "pdf",
  pageCount: 209,
  fullText: "エッジはサーバーレス実行基盤です。",
  readingState: null,
  title: null,
  pageDirection: "ltr",
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

  it.each(["grid", "compact"])(
    "says which format a title held in one file is, in the %s layout too",
    async (layout) => {
      localStorage.setItem("chatbook:shelf-layout", JSON.stringify(layout));
      try {
        renderShelf({
          loadBooks: async () => [
            book({ id: "epub", fileName: "吾輩は猫である.epub", format: "epub", pageCount: 11 }),
            book({ id: "pdf", fileName: "Rust 入門.pdf", pageCount: 209 }),
          ],
          loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
        });

        expect(
          await screen.findByRole("button", { name: "吾輩は猫である を開く" }),
        ).toHaveTextContent("EPUB");
        expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toHaveTextContent("PDF");
        expect(
          await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" }),
        ).toHaveTextContent("PDF");
      } finally {
        localStorage.clear();
      }
    },
  );

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
    await openShelfSettings();
    expect(screen.getByRole("button", { name: "Dropboxフォルダを設定" })).toBeInTheDocument();
  });

  it("offers no folder setting on a deploy without Dropbox", async () => {
    renderShelf({ loadBooks: TWO_BOOKS });

    await screen.findByRole("button", { name: "Rust 入門 を開く" });
    await openShelfSettings();
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

    await openShelfSettings();
    await userEvent.click(await screen.findByRole("button", { name: "Dropboxフォルダを設定" }));
    await userEvent.type(screen.getByRole("textbox"), "/Books");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(saved).toStrictEqual(["/Books"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openShelfSettings();
    expect(await screen.findByText("/Books")).toBeInTheDocument();
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

    await openShelfSettings();
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

  describe("the preferred format", () => {
    afterEach(() => localStorage.clear());

    it("keeps the setting in the shelf's settings menu rather than on the shelf", async () => {
      renderShelf({ loadBooks: PDF_AND_EPUB });

      await screen.findByRole("button", { name: "Rust 入門 を開く" });
      expect(screen.queryByRole("combobox", { name: "優先する形式" })).toBeNull();

      await openShelfSettings();
      expect(screen.getByRole("combobox", { name: "優先する形式" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "設定" })).toHaveAttribute("aria-expanded", "true");

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("combobox", { name: "優先する形式" })).toBeNull();
    });

    it("opens the EPUB from the card once the reader prefers EPUB, and remembers it", async () => {
      renderShelf({ loadBooks: PDF_AND_EPUB });

      await openShelfSettings();
      const preference = await screen.findByRole("combobox", { name: "優先する形式" });
      expect(preference).toHaveValue("pdf");
      await userEvent.selectOptions(preference, "epub");

      expect(JSON.parse(localStorage.getItem("chatbook:preferred-format")!)).toBe("epub");
      await userEvent.click(screen.getByRole("button", { name: "Rust 入門 を開く" }));
      expect(await screen.findByText("リーダー: epub-1")).toBeInTheDocument();
    });

    it("starts from the format chosen on an earlier visit", async () => {
      localStorage.setItem("chatbook:preferred-format", JSON.stringify("epub"));
      renderShelf({ loadBooks: PDF_AND_EPUB });

      await openShelfSettings();
      expect(await screen.findByRole("combobox", { name: "優先する形式" })).toHaveValue("epub");
      await userEvent.click(screen.getByRole("button", { name: "Rust 入門 を開く" }));
      expect(await screen.findByText("リーダー: epub-1")).toBeInTheDocument();
    });

    it("falls back to PDF when what was stored is not a format", async () => {
      localStorage.setItem("chatbook:preferred-format", JSON.stringify("mobi"));
      renderShelf({ loadBooks: PDF_AND_EPUB });

      await openShelfSettings();
      expect(await screen.findByRole("combobox", { name: "優先する形式" })).toHaveValue("pdf");
    });
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

    await userEvent.click(await entryAction("Rust 入門 を非表示"));

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

    await userEvent.click(await entryAction("Rust 入門 を非表示"));

    expect(await screen.findByText(/非表示にすることに失敗しました: down/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
  });
});

describe("ShelfPage: how far each book has been read", () => {
  afterEach(() => localStorage.clear());

  it("shows the share read under the cover of a book that has been opened", async () => {
    renderShelf({ loadBooks: async () => [book({ pageCount: 200, lastReadPage: 24 })] });

    const card = await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" });
    expect(card).toHaveTextContent("12%");
    expect(card).toHaveAccessibleDescription("12%読了");
    expect(card.querySelector("[data-progress]")).toHaveStyle({ width: "12%" });
  });

  it("marks a book never opened as unread rather than 0%", async () => {
    renderShelf({ loadBooks: async () => [book({ lastReadPage: null })] });

    const card = await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" });
    expect(card).toHaveAccessibleDescription("未読");
    expect(card).not.toHaveTextContent("%");
    expect(card.querySelector("[data-progress]")).toBeNull();
  });

  it("calls the last page 100%", async () => {
    renderShelf({ loadBooks: async () => [book({ pageCount: 200, lastReadPage: 200 })] });

    expect(
      await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toHaveAccessibleDescription("100%読了");
  });

  it("says nothing of progress for a file still waiting in Dropbox", async () => {
    renderShelf({ loadBooks: async () => [], loadDropboxFolder: FOLDER_WITH_ONE_BOOK });

    const card = await screen.findByRole("button", { name: "Zig 入門 を Dropbox から開く" });
    expect(card).toHaveTextContent("/lang · 未読み込み");
    expect(card).not.toHaveAccessibleDescription();
    expect(card.querySelector("[data-progress]")).toBeNull();
  });

  it("gives an entry of several files the progress of the furthest read", async () => {
    renderShelf({
      loadBooks: async () => [
        book({ id: "pdf", fileName: "Rust 入門.pdf", pageCount: 200, lastReadPage: 20 }),
        book({
          id: "epub",
          fileName: "Rust 入門.epub",
          format: "epub",
          pageCount: 10,
          lastReadPage: 5,
        }),
      ],
    });

    expect(
      await screen.findByRole("button", { name: "Rust 入門 を開く" }),
    ).toHaveAccessibleDescription("50%読了");
  });

  it("shows the share read on a compact row too", async () => {
    localStorage.setItem("chatbook:shelf-layout", JSON.stringify("compact"));
    renderShelf({
      loadBooks: async () => [
        book({ pageCount: 200, lastReadPage: 24 }),
        book({ id: "book-2", fileName: "Rust 入門.pdf", lastReadPage: null }),
      ],
    });

    const read = await screen.findByRole("button", { name: "Cloudflare Workers 入門 を開く" });
    expect(read).toHaveTextContent("12%");
    expect(read).toHaveAccessibleDescription("12%読了");
    expect(read.querySelector("[data-progress]")).toHaveStyle({ width: "12%" });
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toHaveAccessibleDescription(
      "未読",
    );
  });
});

describe("ShelfPage: finding a book", () => {
  const THREE_BOOKS = async () => [
    book(),
    book({ id: "book-2", fileName: "Rust 入門.pdf" }),
    book({ id: "book-3", fileName: "TypeScript ハンドブック.pdf" }),
  ];

  const searchBox = () => screen.findByRole("searchbox", { name: "本棚を検索" });

  it("narrows the shelf to the titles holding what is typed, whatever its case", async () => {
    renderShelf({ loadBooks: THREE_BOOKS });

    await userEvent.type(await searchBox(), "rust");

    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "TypeScript ハンドブック を開く" }),
    ).not.toBeInTheDocument();
    // Adding a book does not go through the list, so the way in stays.
    expect(screen.getByRole("button", { name: "本を追加" })).toBeInTheDocument();
  });

  it("brings the whole shelf back once the box is emptied", async () => {
    renderShelf({ loadBooks: THREE_BOOKS });

    const box = await searchBox();
    await userEvent.type(box, "rust");
    await userEvent.clear(box);

    expect(screen.getAllByRole("button", { name: / を開く$/ })).toHaveLength(3);
  });

  it("says nothing matched, and keeps the way to add a book", async () => {
    renderShelf({ loadBooks: THREE_BOOKS });

    await userEvent.type(await searchBox(), "Go 言語");

    expect(screen.getByText("「Go 言語」に一致する本はありません")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: / を開く$/ })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "本を追加" })).toBeInTheDocument();
    expect(screen.queryByText("まだ本がありません")).not.toBeInTheDocument();
  });

  it("narrows while an input method is still composing the word", async () => {
    renderShelf({ loadBooks: THREE_BOOKS });

    const box = await searchBox();
    fireEvent.compositionStart(box);
    fireEvent.change(box, { target: { value: "ハンド" } });

    expect(box).toHaveValue("ハンド");
    expect(
      screen.getByRole("button", { name: "TypeScript ハンドブック を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rust 入門 を開く" })).not.toBeInTheDocument();

    fireEvent.compositionEnd(box);
    expect(box).toHaveValue("ハンド");
  });

  it("narrows the list of hidden books by the same words", async () => {
    renderShelf({
      loadBooks: THREE_BOOKS,
      loadHidden: async () => ({ keys: ["book-2", "book-3"] }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "非表示の本 (2)" }));
    await userEvent.type(await searchBox(), "type");

    const list = screen.getByRole("region", { name: "非表示の本" });
    expect(list).toHaveTextContent("TypeScript ハンドブック");
    expect(list).not.toHaveTextContent("Rust 入門");

    const box = screen.getByRole("searchbox", { name: "本棚を検索" });
    await userEvent.clear(box);
    await userEvent.type(box, "zig");
    expect(list).toHaveTextContent("「zig」に一致する本はありません");
  });
});

describe("ShelfPage: renaming a book", () => {
  const PDF_AND_EPUB = async () => [
    book({ id: "pdf-1", fileName: "Rust 入門.pdf" }),
    book({ id: "epub-1", fileName: "Rust 入門.epub", format: "epub", pageCount: 12 }),
  ];

  /** Records what it was asked to rename, answering the way the server does. */
  function recordingRenamer() {
    const calls: { id: string; title: string | null }[] = [];
    const renameBook: RenameBook = (id, title) => {
      calls.push({ id, title });
      return okAsync({ id, title: title?.trim() || null });
    };
    return { calls, renameBook };
  }

  async function renameTo(entryTitle: string, typed: string) {
    await userEvent.click(await entryAction(`${entryTitle} の題名を変更`));
    const dialog = screen.getByRole("dialog", { name: "題名の変更" });
    const box = within(dialog).getByRole("textbox", { name: "題名" });
    expect(box).toHaveValue(entryTitle);
    await userEvent.clear(box);
    if (typed !== "") await userEvent.type(box, typed);
    await userEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  }

  it("gives every book of the entry the new title, and the shelf shows it", async () => {
    const { calls, renameBook } = recordingRenamer();
    renderShelf({ loadBooks: PDF_AND_EPUB, renameBook });

    await renameTo("Rust 入門", "プログラミング Rust");

    expect(calls).toStrictEqual([
      { id: "pdf-1", title: "プログラミング Rust" },
      { id: "epub-1", title: "プログラミング Rust" },
    ]);
    expect(
      await screen.findByRole("button", { name: "プログラミング Rust を開く" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Still one entry: both files went to the same title together.
    expect(screen.getAllByText("プログラミング Rust", { selector: "p" })).toHaveLength(1);
  });

  it("goes back to the file's name when the title is emptied", async () => {
    const { calls, renameBook } = recordingRenamer();
    renderShelf({
      loadBooks: async () => [book({ id: "a", fileName: "scan_0001.pdf", title: "付けた題名" })],
      renameBook,
    });

    await renameTo("付けた題名", "");

    expect(calls).toStrictEqual([{ id: "a", title: null }]);
    expect(await screen.findByRole("button", { name: "scan_0001 を開く" })).toBeInTheDocument();
  });

  it("hands the reader the new title too, without reading the book again", async () => {
    const { renameBook } = recordingRenamer();
    const cached: BookDetail = {
      id: "book-1",
      fileName: "Cloudflare Workers 入門.pdf",
      format: "pdf",
      pageCount: 209,
      hasThumbnail: false,
      hasOutline: false,
      hasOcr: false,
      selections: [],
      readingState: null,
      title: null,
      pageDirection: "ltr",
    };
    renderShelf({
      loadBooks: async () => [book()],
      renameBook,
      seed: { [bookKey("book-1")]: cached },
    });

    await renameTo("Cloudflare Workers 入門", "エッジ入門");
    await userEvent.click(await screen.findByRole("button", { name: "エッジ入門 を開く" }));

    expect(await screen.findByText("リーダー: book-1")).toBeInTheDocument();
    expect(screen.getByText("題名: エッジ入門")).toBeInTheDocument();
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    renderShelf({
      loadBooks: async () => [book()],
      renameBook: () => errAsync(new ApiError("Server exploded", "INTERNAL_ERROR", 500)),
    });

    await renameTo("Cloudflare Workers 入門", "エッジ入門");

    const dialog = await screen.findByRole("dialog", { name: "題名の変更" });
    expect(dialog).toHaveTextContent("題名を変更できませんでした: Server exploded");
    expect(within(dialog).getByRole("textbox", { name: "題名" })).toHaveValue("エッジ入門");
    expect(
      screen.getByRole("button", { name: "Cloudflare Workers 入門 を開く" }),
    ).toBeInTheDocument();
  });

  it("leaves the title alone when the dialog is cancelled", async () => {
    const { calls, renameBook } = recordingRenamer();
    renderShelf({ loadBooks: async () => [book()], renameBook });

    await userEvent.click(await entryAction("Cloudflare Workers 入門 の題名を変更"));
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toStrictEqual([]);
  });

  /** Records what Dropbox files it was asked to title, answering with every title. */
  function recordingFileTitler(start: DropboxTitles["titles"] = []) {
    const calls: { keys: string[]; title: string | null }[] = [];
    let stored = new Map(start.map((t) => [t.key, t.title]));
    const setDropboxTitles: SetDropboxTitles = (keys, title) => {
      calls.push({ keys, title });
      stored = new Map(stored);
      for (const key of keys) {
        if (title?.trim()) stored.set(key, title.trim());
        else stored.delete(key);
      }
      return okAsync({ titles: [...stored].map(([key, t]) => ({ key, title: t })) });
    };
    return { calls, setDropboxTitles };
  }

  it("titles a file still waiting in Dropbox, which leaves the file's own name alone", async () => {
    const { calls, setDropboxTitles } = recordingFileTitler();
    const { calls: bookCalls, renameBook } = recordingRenamer();
    renderShelf({
      loadBooks: async () => [],
      loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
      renameBook,
      setDropboxTitles,
    });

    await renameTo("Zig 入門", "プログラミング Zig");

    expect(calls).toStrictEqual([{ keys: ["id:zig"], title: "プログラミング Zig" }]);
    expect(bookCalls).toStrictEqual([]);
    expect(
      await screen.findByRole("button", { name: "プログラミング Zig を Dropbox から開く" }),
    ).toBeInTheDocument();
  });

  it("shows a Dropbox file by the title the server keeps for it", async () => {
    renderShelf({
      loadBooks: async () => [],
      loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
      loadDropboxTitles: async () => ({ titles: [{ key: "id:zig", title: "付けた題名" }] }),
    });

    expect(
      await screen.findByRole("button", { name: "付けた題名 を Dropbox から開く" }),
    ).toBeInTheDocument();
  });

  it("titles the book and the Dropbox file of an entry together, so it stays one entry", async () => {
    const { calls, setDropboxTitles } = recordingFileTitler();
    const { calls: bookCalls, renameBook } = recordingRenamer();
    renderShelf({
      loadBooks: async () => [book({ id: "pdf-1", fileName: "Zig 入門.pdf" })],
      loadDropboxFolder: async () => ({
        state: "ready",
        folder: "/Books",
        files: [{ ...DROPBOX_BOOK, dropboxId: "id:zig-epub", name: "Zig 入門.epub" }],
      }),
      renameBook,
      setDropboxTitles,
    });

    await renameTo("Zig 入門", "プログラミング Zig");

    expect(bookCalls).toStrictEqual([{ id: "pdf-1", title: "プログラミング Zig" }]);
    expect(calls).toStrictEqual([{ keys: ["id:zig-epub"], title: "プログラミング Zig" }]);
    await screen.findByRole("button", { name: "プログラミング Zig を開く" });
    expect(screen.getAllByText("プログラミング Zig", { selector: "p" })).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "プログラミング Zig を EPUB で開く（Dropbox・未読み込み）",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open and says why when the Dropbox file's title is refused", async () => {
    renderShelf({
      loadBooks: async () => [],
      loadDropboxFolder: FOLDER_WITH_ONE_BOOK,
      setDropboxTitles: () => errAsync(new ApiError("Server exploded", "INTERNAL_ERROR", 500)),
    });

    await renameTo("Zig 入門", "プログラミング Zig");

    const dialog = await screen.findByRole("dialog", { name: "題名の変更" });
    expect(dialog).toHaveTextContent("題名を変更できませんでした: Server exploded");
  });
});

describe("ShelfPage: reading a book of pictures by OCR in the background", () => {
  /** A file pdf.js found no text in: a book of pictures, for OCR to read later. */
  const readsPictures = async (file: File): Promise<ExtractedPdfData> => ({
    ...(await readsFine(file)),
    fullText: "",
    needsOcr: true,
  });

  /** A reading the test steps through. */
  function steppedReading() {
    const asked: { pdfId: string; file: File | null; signal: AbortSignal }[] = [];
    let report: (done: number, total: number) => void = () => {};
    let finish: (read: { fullText: string; pages: [] }) => void = () => {};
    const readByOcr: ReadStoredBookByOcr = (pdfId, file, { signal, onProgress }) => {
      asked.push({ pdfId, file, signal });
      report = (done, total) => onProgress({ done, total });
      return new Promise((resolve, reject) => {
        finish = resolve;
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("OCR was cancelled"), { name: "AbortError" })),
        );
      });
    };
    return {
      asked,
      readByOcr,
      report: (done: number, total: number) => act(() => report(done, total)),
      finish: (fullText: string) => act(() => finish({ fullText, pages: [] })),
    };
  }

  const WAITING = async () => [
    book({ id: "scan-1", fileName: "スキャン本.pdf", ocrPending: true }),
  ];

  it("stores a book of pictures and opens it, and reads it from the file just chosen", async () => {
    // The shelf is not held up for the minutes OCR takes: the book is there
    // to read at once, and its text follows.
    const sending = fakeUpload();
    const reading = steppedReading();
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: readsPictures,
      createUploadRequest: () => sending.request,
      readByOcr: reading.readByOcr,
    });

    await screen.findByRole("button", { name: "本を追加" });
    const chosen = A_PDF();
    await chooseFile(container, chosen);
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());
    expect((sending.sentBody() as FormData).get("ocrPending")).toBe("true");
    act(() => {
      sending.answers({ ...STORED_BOOK, fullText: "", ocrPending: true });
    });

    expect(await screen.findByText(`リーダー: ${STORED_ID}`)).toBeInTheDocument();
    expect(reading.asked).toHaveLength(1);
    expect(reading.asked[0].pdfId).toBe(STORED_ID);
    expect(reading.asked[0].file).toBe(chosen);
  });

  it("starts no reading for a book the server already holds the text of", async () => {
    const sending = fakeUpload();
    const reading = steppedReading();
    const { container } = renderShelf({
      loadBooks: TWO_BOOKS,
      extract: readsPictures,
      createUploadRequest: () => sending.request,
      readByOcr: reading.readByOcr,
    });

    await screen.findByRole("button", { name: "本を追加" });
    await chooseFile(container, A_PDF());
    await waitFor(() => expect(sending.openedWith()).not.toBeNull());
    act(() => {
      sending.answers({ ...STORED_BOOK, ocrPending: false });
    });

    expect(await screen.findByText(`リーダー: ${STORED_ID}`)).toBeInTheDocument();
    expect(reading.asked).toHaveLength(0);
  });

  it("says a reading that stopped is unfinished, and starts it again from the stored book", async () => {
    // A tab that was closed or reloaded took its reading with it; the server
    // still says the book is waiting.
    const reading = steppedReading();
    renderShelf({ loadBooks: WAITING, readByOcr: reading.readByOcr });

    expect(await screen.findByText("文字の読み取りが途中です")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    );

    expect(reading.asked).toStrictEqual([expect.objectContaining({ pdfId: "scan-1", file: null })]);
  });

  it("counts the pages up on the book's entry, and stops the reading on 中止", async () => {
    const reading = steppedReading();
    renderShelf({ loadBooks: WAITING, readByOcr: reading.readByOcr });
    await userEvent.click(
      await screen.findByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    );

    reading.report(12, 200);
    expect(await screen.findByText("文字を読み取り中 12/200 ページ")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "スキャン本 の文字の読み取りを中止" }),
    );

    expect(reading.asked[0].signal.aborted).toBe(true);
    // Not a failure — the reader asked for it — and the book is still waiting
    expect(await screen.findByText("文字の読み取りが途中です")).toBeInTheDocument();
    expect(screen.queryByText(/読み取れませんでした/)).not.toBeInTheDocument();
  });

  it("takes the notice away once what was read is stored", async () => {
    const reading = steppedReading();
    const saved: string[] = [];
    renderShelf({
      loadBooks: WAITING,
      readByOcr: reading.readByOcr,
      saveOcr: (pdfId, read) => {
        saved.push(`${pdfId}: ${read.fullText}`);
        return okAsync({ id: pdfId, hasOcr: false });
      },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    );

    reading.finish("灯台の記録");

    await waitFor(() =>
      expect(screen.queryByText(/文字の読み取り|文字を/)).not.toBeInTheDocument(),
    );
    expect(saved).toStrictEqual(["scan-1: 灯台の記録"]);
  });

  it("says why the text could not be stored, and offers to read it again", async () => {
    const reading = steppedReading();
    renderShelf({
      loadBooks: WAITING,
      readByOcr: reading.readByOcr,
      saveOcr: () => errAsync(new ApiError("Server exploded", "INTERNAL_ERROR", 500)),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    );

    reading.finish("灯台の記録");

    expect(
      await screen.findByText("文字を読み取れませんでした: Server exploded"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    ).toBeInTheDocument();
  });

  it("says so when not a word could be read off the book", async () => {
    const reading = steppedReading();
    renderShelf({
      loadBooks: WAITING,
      readByOcr: reading.readByOcr,
      saveOcr: (pdfId) => okAsync({ id: pdfId, hasOcr: false }),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "スキャン本 の文字の読み取りを再開" }),
    );

    reading.finish("\f \f");

    expect(await screen.findByText("このPDFからは文字を読み取れませんでした")).toBeInTheDocument();
  });
});

describe("ShelfPage: collections", () => {
  afterEach(() => localStorage.clear());

  const SHELF = async () => [
    book({ id: "pdf-1", fileName: "Rust 入門.pdf", hasThumbnail: true }),
    book({ id: "epub-1", fileName: "Rust 入門.epub", format: "epub" }),
    book({ id: "zig", fileName: "Zig 入門.pdf" }),
    book({ id: "go", fileName: "Go 入門.pdf" }),
  ];

  /** Switches the shelf to its collections. */
  async function showCollections() {
    await userEvent.click(await screen.findByRole("radio", { name: "コレクション" }));
  }

  it("puts every file of an entry in the collection ticked in its 「…」, and ticks it", async () => {
    const store = collectionStore([collectionOf("c1", "技術書"), collectionOf("c2", "積読")]);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await userEvent.click(await entryAction("Rust 入門 のコレクションを選ぶ"));
    const dialog = screen.getByRole("dialog", { name: "コレクションに入れる" });
    const box = within(dialog).getByRole("checkbox", { name: "技術書" });
    expect(box).not.toBeChecked();

    await userEvent.click(box);

    expect(store.calls).toStrictEqual(["add c1 [pdf-1,epub-1]"]);
    await waitFor(() => expect(box).toBeChecked());
    expect(within(dialog).getByRole("checkbox", { name: "積読" })).not.toBeChecked();

    // And out again
    await userEvent.click(box);
    expect(store.calls).toStrictEqual(["add c1 [pdf-1,epub-1]", "take c1 [pdf-1,epub-1]"]);
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it("ticks a collection that holds only one of the entry's files", async () => {
    // The EPUB turned up after the PDF was filed; the title is still in it.
    const store = collectionStore([collectionOf("c1", "技術書", ["pdf-1"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await userEvent.click(await entryAction("Rust 入門 のコレクションを選ぶ"));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "技術書" })).toBeChecked());
  });

  it("makes a collection with the entry already in it", async () => {
    const store = collectionStore();
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await userEvent.click(await entryAction("Zig 入門 のコレクションを選ぶ"));
    const dialog = screen.getByRole("dialog", { name: "コレクションに入れる" });
    expect(within(dialog).getByText("まだコレクションがありません")).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "新しいコレクションの名前" }),
      "言語",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "作成して入れる" }));

    expect(store.calls).toStrictEqual(["create 言語 [zig]"]);
    expect(await within(dialog).findByRole("checkbox", { name: "言語" })).toBeChecked();
  });

  it("says why in the dialog when the server refuses, and leaves the box as it was", async () => {
    const store = collectionStore([collectionOf("c1", "技術書")], true);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await userEvent.click(await entryAction("Rust 入門 のコレクションを選ぶ"));
    const box = screen.getByRole("checkbox", { name: "技術書" });
    await userEvent.click(box);

    expect(await screen.findByText("コレクションを変更できませんでした: down")).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(screen.getByRole("dialog", { name: "コレクションに入れる" })).toBeInTheDocument();
  });

  it("shows a tile per collection with how many books it holds, and 未分類 for the rest", async () => {
    const store = collectionStore([
      collectionOf("c1", "積読", ["zig"]),
      collectionOf("c2", "技術書", ["epub-1", "zig"]),
    ]);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await showCollections();

    const tiles = within(await screen.findByRole("list", { name: "コレクション" }));
    // By name, the way a reader looks one up
    expect(
      tiles.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toStrictEqual([
      "コレクション「技術書」を開く",
      "コレクション「積読」を開く",
      "未分類の本を開く",
      "＋新しいコレクション",
    ]);
    expect(tiles.getByRole("button", { name: "コレクション「技術書」を開く" })).toHaveTextContent(
      "2 冊",
    );
    expect(tiles.getByRole("button", { name: "未分類の本を開く" })).toHaveTextContent("1 冊");
    // The books are behind the tiles, not beside them
    expect(screen.queryByRole("button", { name: "Go 入門 を開く" })).not.toBeInTheDocument();
  });

  it("stacks the covers of what a collection holds on its tile", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["pdf-1", "zig"])]);
    const { container } = renderShelf({ loadBooks: SHELF, collections: store.api });

    await showCollections();
    await screen.findByRole("button", { name: "コレクション「技術書」を開く" });

    expect(
      [...container.querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toStrictEqual(["/api/pdf/pdf-1/thumbnail"]);
  });

  it("lists only a collection's books once its tile is opened, and goes back to the tiles", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["epub-1", "zig"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await showCollections();
    await userEvent.click(
      await screen.findByRole("button", { name: "コレクション「技術書」を開く" }),
    );

    expect(screen.getByRole("heading", { name: /技術書/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rust 入門 を開く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zig 入門 を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go 入門 を開く" })).not.toBeInTheDocument();
    // The shelf's own tools work inside it
    await userEvent.type(screen.getByRole("searchbox", { name: "本棚を検索" }), "zig");
    expect(screen.queryByRole("button", { name: "Rust 入門 を開く" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本を追加" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "← コレクション" }));
    expect(
      screen.getByRole("button", { name: "コレクション「技術書」を開く" }),
    ).toBeInTheDocument();
  });

  it("lists what is in no collection under 未分類", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["pdf-1", "zig"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await showCollections();
    await userEvent.click(await screen.findByRole("button", { name: "未分類の本を開く" }));

    expect(screen.getByRole("button", { name: "Go 入門 を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zig 入門 を開く" })).not.toBeInTheDocument();
    // 未分類 is not the reader's to rename or delete
    expect(
      screen.queryByRole("button", { name: "コレクションの名前を変更" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a hidden book out of its collection", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["zig", "go"])]);
    renderShelf({
      loadBooks: SHELF,
      collections: store.api,
      loadHidden: async () => ({ keys: ["go"] }),
    });

    await showCollections();
    expect(
      await screen.findByRole("button", { name: "コレクション「技術書」を開く" }),
    ).toHaveTextContent("1 冊");
    await userEvent.click(screen.getByRole("button", { name: "コレクション「技術書」を開く" }));

    expect(screen.getByRole("button", { name: "Zig 入門 を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go 入門 を開く" })).not.toBeInTheDocument();
  });

  it("opens straight into the collection the address names", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["zig"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api, initialEntry: "/?collection=c1" });

    expect(await screen.findByRole("button", { name: "Zig 入門 を開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go 入門 を開く" })).not.toBeInTheDocument();
  });

  it("comes back to the collections on the next visit", async () => {
    localStorage.setItem("chatbook:shelf-view", JSON.stringify("collections"));
    renderShelf({ loadBooks: SHELF, collections: collectionStore().api });

    expect(await screen.findByRole("button", { name: "未分類の本を開く" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "コレクション" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "一覧" }));
    expect(screen.getByRole("button", { name: "Go 入門 を開く" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("chatbook:shelf-view")!)).toBe("all");
  });

  it("makes a collection from the tile at the end", async () => {
    const store = collectionStore();
    renderShelf({ loadBooks: SHELF, collections: store.api });

    await showCollections();
    await userEvent.click(await screen.findByRole("button", { name: "新しいコレクション" }));
    const dialog = screen.getByRole("dialog", { name: "新しいコレクション" });
    const save = within(dialog).getByRole("button", { name: "作成" });
    // Nothing to keep a collection under yet
    expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "コレクションの名前" }),
      "積読",
    );
    await userEvent.click(save);

    expect(store.calls).toStrictEqual(["create 積読 []"]);
    expect(
      await screen.findByRole("button", { name: "コレクション「積読」を開く" }),
    ).toHaveTextContent("0 冊");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and says why when the name is refused", async () => {
    renderShelf({ loadBooks: SHELF, collections: collectionStore([], true).api });

    await showCollections();
    await userEvent.click(await screen.findByRole("button", { name: "新しいコレクション" }));
    const dialog = screen.getByRole("dialog", { name: "新しいコレクション" });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "コレクションの名前" }),
      "積読",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }));

    expect(
      await within(dialog).findByText("コレクションを保存できませんでした: down"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "コレクションの名前" })).toHaveValue("積読");
  });

  it("renames the collection it is in", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["zig"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api, initialEntry: "/?collection=c1" });

    await userEvent.click(await screen.findByRole("button", { name: "コレクションの名前を変更" }));
    const box = screen.getByRole("textbox", { name: "コレクションの名前" });
    expect(box).toHaveValue("技術書");
    await userEvent.clear(box);
    await userEvent.type(box, "プログラミング");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(store.calls).toStrictEqual(["rename c1 プログラミング"]);
    expect(await screen.findByRole("heading", { name: /プログラミング/ })).toBeInTheDocument();
  });

  it("deletes the collection it is in once the reader agrees, saying the books stay", async () => {
    const store = collectionStore([collectionOf("c1", "技術書", ["zig"])]);
    renderShelf({ loadBooks: SHELF, collections: store.api, initialEntry: "/?collection=c1" });

    await userEvent.click(await screen.findByRole("button", { name: "コレクションの削除" }));
    expect(
      screen.getByText(
        "コレクション「技術書」を削除しますか？中の本は削除されず、本棚に残ります。",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(store.calls).toStrictEqual(["remove c1"]);
    // Back at the whole shelf, where the book still is
    expect(await screen.findByRole("button", { name: "Zig 入門 を開く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go 入門 を開く" })).toBeInTheDocument();
  });

  it("says why when a collection could not be deleted", async () => {
    renderShelf({
      loadBooks: SHELF,
      collections: collectionStore([collectionOf("c1", "技術書", ["zig"])], true).api,
      initialEntry: "/?collection=c1",
    });

    await userEvent.click(await screen.findByRole("button", { name: "コレクションの削除" }));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("コレクションを削除できませんでした: down")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /技術書/ })).toBeInTheDocument();
  });

  it("says the collections could not be read without taking the shelf down", async () => {
    renderShelf({
      loadBooks: SHELF,
      collections: {
        ...collectionStore().api,
        load: async () => {
          throw new Error("D1 is down");
        },
      },
    });

    expect(
      await screen.findByText("コレクションを読めませんでした: D1 is down"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go 入門 を開く" })).toBeInTheDocument();
  });
});
