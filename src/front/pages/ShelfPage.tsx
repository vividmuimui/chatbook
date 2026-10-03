import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import useSWR from "swr";
import type { ResultAsync } from "neverthrow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DropboxFolderDialog, type SaveDropboxFolder } from "../components/DropboxFolderDialog";
import { useOpenPdfBook } from "../hooks/useOpenPdfBook";
import { pickDroppedBook } from "../lib/droppedBook";
import { downloadDropboxFile, type DownloadDropboxFile } from "../lib/dropboxDownload";
import { fetcher, resultFetcher, type ApiError } from "../lib/fetcher";
import type { ExtractedPdfData } from "../lib/pdfLoader";
import { bookDeletedSchema, bookListSchema, type BookSummary } from "../../shared/schemas/book";
import {
  dropboxFolderListingSchema,
  dropboxSettingsSchema,
  type DropboxFile,
  type DropboxFolderListing,
} from "../../shared/schemas/dropbox";

/** Cache key of the shelf, and the endpoint it is read from. */
const SHELF_KEY = "/api/pdfs";

/** Read by SWR, so a refusal belongs in its `error` state: this one throws. */
const fetchBooks = () => fetcher(SHELF_KEY, bookListSchema).then((data) => data.books);

/** Removes a book. A write, so its failure comes back in the value. */
export type DeleteBook = (id: string) => ResultAsync<unknown, ApiError>;

const requestBookDeletion: DeleteBook = (id) =>
  resultFetcher(`/api/pdf/${id}`, bookDeletedSchema, { method: "DELETE" });

/**
 * Cache key of the Dropbox folder's books that are not on the shelf yet. Read
 * apart from the shelf so the books already on it never wait for Dropbox.
 */
const DROPBOX_KEY = "/api/dropbox/files";

const fetchDropboxFolder = () => fetcher(DROPBOX_KEY, dropboxFolderListingSchema);

const requestFolderSave: SaveDropboxFolder = (folder) =>
  resultFetcher("/api/dropbox/settings", dropboxSettingsSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });

interface ShelfPageProps {
  loadBooks?: () => Promise<BookSummary[]>;
  deleteBook?: DeleteBook;
  /** Passed straight to the file picker; injectable so tests can fail a read. */
  extract?: (file: File) => Promise<ExtractedPdfData>;
  /** The upload's own request; injectable so tests can drive its progress. */
  createUploadRequest?: () => XMLHttpRequest;
  loadDropboxFolder?: () => Promise<DropboxFolderListing>;
  saveDropboxFolder?: SaveDropboxFolder;
  downloadDropbox?: DownloadDropboxFile;
}

/**
 * How far a chosen file has got, as the shelf tells the reader about it.
 *
 * Three states rather than a share alone: the reading happens before anything
 * has been sent, and once the whole body is up there is still the server
 * writing it away — a bar sat at 0% or at 100% for either of those reads as a
 * shelf that has hung.
 */
type Importing =
  | { phase: "downloading"; ratio: number }
  | { phase: "reading" }
  | { phase: "uploading"; ratio: number }
  | { phase: "storing" };

/** What the reader is told while a book is on its way in. */
function importWording(importing: Importing): string {
  switch (importing.phase) {
    case "downloading":
      return `Dropboxから取得中 ${Math.round(importing.ratio * 100)}%`;
    case "reading":
      return "本を読み取り中...";
    case "uploading":
      return `アップロード中 ${Math.round(importing.ratio * 100)}%`;
    case "storing":
      return "保存中...";
  }
}

function bookTitle(fileName: string): string {
  return fileName.replace(/\.(pdf|epub)$/i, "");
}

/**
 * How long a book is, in what it is made of: an EPUB has no pages of its own,
 * and what the reader turns through there is its chapters.
 */
function bookLength(book: BookSummary): string {
  return book.format === "epub" ? `${book.pageCount} 章` : `${book.pageCount} ページ`;
}

function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: BookSummary;
  onOpen: (id: string) => void;
  onDelete: (book: BookSummary) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = book.hasThumbnail && !coverFailed;
  const title = bookTitle(book.fileName);

  return (
    <div className="relative group/card">
      <button
        type="button"
        aria-label={`${title} を開く`}
        onClick={() => onOpen(book.id)}
        className="group flex w-full flex-col text-left cursor-pointer focus:outline-none"
      >
        <div className="relative aspect-3/4 w-full overflow-hidden rounded-r-md rounded-l-sm border-l-4 border-gray-300 bg-gray-100 shadow-md transition-all group-hover:-translate-y-1 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-blue-500">
          {showCover ? (
            <img
              src={`/api/pdf/${book.id}/thumbnail`}
              alt={`${title} の表紙`}
              loading="lazy"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-slate-600 to-slate-800 p-3">
              <span className="line-clamp-5 text-center text-xs font-medium text-white/90">
                {title}
              </span>
            </div>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-800">{title}</p>
        <p className="text-xs text-gray-500">{bookLength(book)}</p>
      </button>

      {/* Kept out of the way until the pointer arrives — but only where there
          is a pointer to arrive. A finger never hovers, so on a touch-sized
          screen the button is simply there, at a size a thumb can hit. */}
      <button
        type="button"
        aria-label={`${title} を削除`}
        onClick={() => onDelete(book)}
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-lg leading-normal text-white transition-opacity cursor-pointer hover:bg-red-600 md:h-auto md:w-auto md:px-2 md:py-0.5 md:text-sm md:opacity-0 md:focus-visible:opacity-100 md:group-hover/card:opacity-100 [@media(hover:none)]:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

/**
 * A PDF or EPUB in the Dropbox folder that has not been opened here yet. It has no
 * cover and no page count until it has been read, so it says where it is
 * instead — and looks unlike the books, so it is not mistaken for one.
 */
function DropboxFileCard({
  file,
  onOpen,
}: {
  file: DropboxFile;
  onOpen: (file: DropboxFile) => void;
}) {
  const title = bookTitle(file.name);
  // The folder under the chosen one, or nothing for a file at its top.
  const subfolder = file.path.slice(0, file.path.lastIndexOf("/"));

  return (
    <button
      type="button"
      aria-label={`${title} を Dropbox から開く`}
      onClick={() => onOpen(file)}
      className="group flex w-full flex-col text-left cursor-pointer focus:outline-none"
    >
      <div className="relative aspect-3/4 w-full overflow-hidden rounded-r-md rounded-l-sm border-l-4 border-sky-300 shadow-md transition-all group-hover:-translate-y-1 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-blue-500">
        <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-sky-500 to-blue-700 p-3">
          <span className="line-clamp-5 text-center text-xs font-medium text-white/90">
            {title}
          </span>
        </div>
        <span className="absolute left-1.5 top-1.5 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
          Dropbox
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-800">{title}</p>
      <p className="truncate text-xs text-gray-500">
        {subfolder ? `${subfolder} · ` : ""}未読み込み
      </p>
    </button>
  );
}

/**
 * The way to add a book, sitting where books do.
 *
 * The input it drives carries no name of its own, so the button is what a
 * reader — and a test — reaches for. The plus is decoration: naming it would
 * put it in the button's name, which both jsdom and the shelf's own wording
 * match in full.
 */
function AddBookTile({
  onFileChosen,
  disabled,
}: {
  onFileChosen: (file: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex aspect-3/4 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-gray-300 bg-white/40 text-gray-500 transition-colors cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:bg-white/40 disabled:hover:text-gray-500"
      >
        <span aria-hidden="true" className="text-3xl leading-none">
          ＋
        </span>
        <span className="text-sm font-medium">本を追加</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,application/epub+zip,.epub"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChosen(file);
          // Allow choosing the same file again. Cleared after the file has
          // been handed over, so nothing is read out of an emptied input.
          e.target.value = "";
        }}
        className="hidden"
      />
    </>
  );
}

export function ShelfPage({
  loadBooks = fetchBooks,
  deleteBook = requestBookDeletion,
  extract,
  createUploadRequest,
  loadDropboxFolder = fetchDropboxFolder,
  saveDropboxFolder = requestFolderSave,
  downloadDropbox = downloadDropboxFile,
}: ShelfPageProps = {}) {
  const navigate = useNavigate();
  const { data: books, error: loadError, mutate } = useSWR(SHELF_KEY, loadBooks);
  const {
    data: dropbox,
    error: dropboxError,
    mutate: mutateDropbox,
  } = useSWR(DROPBOX_KEY, loadDropboxFolder);
  const dropboxFiles = dropbox?.state === "ready" ? dropbox.files : [];
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [importing, setImporting] = useState<Importing | null>(null);
  const openFile = useOpenPdfBook(
    extract,
    // The share the browser reports is the upload's alone; once it is all up
    // what is left is the server, which cannot report anything.
    (ratio) => setImporting(ratio >= 1 ? { phase: "storing" } : { phase: "uploading", ratio }),
    createUploadRequest,
  );
  // What the reader's last action did wrong: adding a book, or removing one.
  // Both are worded by whoever detected them and shown in the same place.
  const [actionError, setActionError] = useState<string | null>(null);
  const [bookPendingDeletion, setBookPendingDeletion] = useState<BookSummary | null>(null);
  // How many elements of the shelf the drag is currently inside. Every card it
  // passes over sends a leave of its own, so a plain boolean would flicker off
  // halfway across the shelf.
  const [dragDepth, setDragDepth] = useState(0);

  const error =
    actionError ??
    (loadError ? `本棚の読み込みに失敗しました: ${(loadError as Error).message}` : null);

  const openBook = useCallback((id: string) => navigate(`/books/${id}`), [navigate]);

  /**
   * Reads a file the reader handed over and leaves for the book it became.
   *
   * `importing` is not put back on the way out: the reader is being taken to
   * the viewer, which takes the notice over until pdf.js has drawn the page.
   * Clearing it here would show them the shelf again for the length of a
   * render, in the middle of opening a book.
   */
  const handleFile = async (file: File) => {
    if (importing) return;
    setActionError(null);
    setImporting({ phase: "reading" });

    const outcome = await openFile(file);
    outcome.match(
      (pdfId) => void openBook(pdfId),
      (failure) => {
        setImporting(null);
        setActionError(`本を開けませんでした: ${failure.message}`);
      },
    );
  };

  /**
   * Brings a book in the Dropbox folder down, reads it, and opens it — the same
   * way in as a file from disk once the bytes are here. The server takes the
   * bytes from Dropbox itself, so the reader does not send them back up.
   */
  const handleDropboxFile = async (entry: DropboxFile) => {
    if (importing) return;
    setActionError(null);
    setImporting({ phase: "downloading", ratio: 0 });

    const outcome = await downloadDropbox(entry, (ratio) =>
      setImporting({ phase: "downloading", ratio }),
    ).andThen((file) => {
      setImporting({ phase: "reading" });
      return openFile(file, entry.dropboxId);
    });
    outcome.match(
      (pdfId) => void openBook(pdfId),
      (failure) => {
        setImporting(null);
        setActionError(`Dropboxの本を開けませんでした: ${failure.message}`);
      },
    );
  };

  /** Whether this drag is carrying something the shelf could take in. */
  const carriesFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragDepth(0);
    if (importing) return;

    const dropped = pickDroppedBook(Array.from(e.dataTransfer.files));
    if (dropped.kind === "book") void handleFile(dropped.file);
    // A drag carrying no files — a text selection, say — is not a mistake to
    // report; only something that was meant to be a book and is not.
    if (dropped.kind === "refused") setActionError(dropped.reason);
  };

  const removeBook = async (book: BookSummary) => {
    setActionError(null);
    setBookPendingDeletion(null);

    const removal = await deleteBook(book.id);
    if (removal.isErr()) {
      setActionError(`削除に失敗しました: ${removal.error.message}`);
      return;
    }

    // The server has already dropped it, so re-reading the shelf would only
    // confirm what this list can work out for itself.
    await mutate((current) => current?.filter((b) => b.id !== book.id), { revalidate: false });
    // Its Dropbox file is still in the folder, and goes back to waiting there.
    if (book.inDropbox) void mutateDropbox();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4">
        <h1 className="text-lg font-bold text-gray-800">chatbook</h1>
        {/* Only where the deploy holds Dropbox credentials. A folder that
            could not be read is still something to change from here. */}
        {(dropboxError || (dropbox && dropbox.state !== "unavailable")) && (
          <button
            type="button"
            onClick={() => setChoosingFolder(true)}
            className="min-w-0 truncate rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
          >
            {dropbox?.state === "ready" ? `Dropbox: ${dropbox.folder}` : "Dropboxフォルダを設定"}
          </button>
        )}
      </header>

      <main
        // Reaches the bottom of the window even with one book on the shelf:
        // this is what a file is dropped on, and a target the height of a
        // single row would leave most of the shelf refusing the drop. 3rem is
        // the header above it (`h-12`).
        className="relative mx-auto min-h-[calc(100dvh-3rem)] max-w-6xl p-6"
        onDragEnter={(e) => {
          if (!carriesFiles(e) || importing) return;
          e.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragOver={(e) => {
          // Without this the browser opens the file instead of handing it over.
          if (carriesFiles(e) && !importing) e.preventDefault();
        }}
        onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
        onDrop={handleDrop}
      >
        {dragDepth > 0 && (
          // Held out of the pointer's way: appearing under the cursor would
          // count as leaving whatever the drag was over and put the shelf back.
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/80">
            <p className="text-lg font-medium text-blue-700">ここにドロップして本を追加</p>
          </div>
        )}

        {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        {dropboxError && (
          <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            Dropboxのフォルダを読めませんでした: {(dropboxError as Error).message}
          </p>
        )}

        {!books && !error && <p className="text-sm text-gray-500">読み込み中...</p>}

        {books?.length === 0 && dropboxFiles.length === 0 && (
          <div className="pt-10 pb-8 text-center">
            <p className="text-lg font-medium text-gray-700">まだ本がありません</p>
            <p className="mt-1 text-sm text-gray-500">
              「本を追加」を押すか、PDFかEPUBのファイルをここにドロップしてください
            </p>
          </div>
        )}

        {/* The tile is a cell of the grid rather than a button in the header:
            adding a book belongs where the books are. The grid is drawn
            whatever the list did — while it loads, and when it could not be
            read at all — because adding a book does not go through it, and a
            shelf that answered with an error would otherwise have no way in. */}
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
          {(books ?? []).map((book) => (
            <li key={book.id}>
              <BookCard book={book} onOpen={openBook} onDelete={setBookPendingDeletion} />
            </li>
          ))}
          {dropboxFiles.map((file) => (
            <li key={file.dropboxId}>
              <DropboxFileCard file={file} onOpen={handleDropboxFile} />
            </li>
          ))}
          <li>
            <AddBookTile onFileChosen={handleFile} disabled={importing !== null} />
          </li>
        </ul>
      </main>

      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <p role="status" className="text-lg text-gray-600">
            {importWording(importing)}
          </p>
        </div>
      )}

      {bookPendingDeletion && (
        <ConfirmDialog
          message={
            `「${bookTitle(bookPendingDeletion.fileName)}」を削除しますか？ハイライトとチャット履歴も削除されます。` +
            (bookPendingDeletion.inDropbox
              ? "Dropbox のファイルは削除されず、未読み込みの本として本棚に残ります。"
              : "")
          }
          dialogLabel="本の削除"
          confirmLabel="削除する"
          onConfirm={() => removeBook(bookPendingDeletion)}
          onCancel={() => setBookPendingDeletion(null)}
        />
      )}

      {choosingFolder && (
        <DropboxFolderDialog
          current={dropbox?.state === "ready" ? dropbox.folder : null}
          save={saveDropboxFolder}
          onSaved={() => {
            setChoosingFolder(false);
            void mutateDropbox();
          }}
          onCancel={() => setChoosingFolder(false)}
        />
      )}
    </div>
  );
}
