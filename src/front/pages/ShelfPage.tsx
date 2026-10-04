import { useState, useCallback, useId, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useAtom, useAtomValue } from "jotai";
import useSWR, { useSWRConfig } from "swr";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { BookTitleDialog } from "../components/BookTitleDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DropboxFolderDialog, type SaveDropboxFolder } from "../components/DropboxFolderDialog";
import { preferredFormatAtom, shelfLayoutAtom } from "../atoms/settingsAtom";
import { ShelfSettingsMenu } from "../components/ShelfSettingsMenu";
import { bookKey } from "../hooks/useBook";
import { useOpenPdfBook, type StoredBook } from "../hooks/useOpenPdfBook";
import { bookTitle } from "../lib/bookTitle";
import { pickDroppedBook } from "../lib/droppedBook";
import { downloadDropboxFile, type DownloadDropboxFile } from "../lib/dropboxDownload";
import { fetcher, resultFetcher, type ApiError } from "../lib/fetcher";
import type { ExtractedPdfData } from "../lib/pdfLoader";
import type { OcrQueue } from "../lib/ocrQueue";
import { ocrRunning, ocrStopped, ocrWording } from "../lib/ocrWording";
import { SHELF_KEY } from "../lib/shelfKey";
import {
  useBackgroundOcr,
  type BackgroundOcr,
  type ReadStoredBookByOcr,
  type SaveOcr,
} from "../hooks/useBackgroundOcr";
import { groupProgress } from "../lib/readingProgress";
import {
  filterShelf,
  groupShelf,
  splitHidden,
  type ShelfGroup,
  type ShelfMember,
} from "../lib/shelfGroups";
import {
  bookDeletedSchema,
  bookListSchema,
  bookRenamedSchema,
  type BookDetail,
  type BookFormat,
  type BookRenamed,
  type BookSummary,
  type RenameBookRequest,
} from "../../shared/schemas/book";
import {
  dropboxTitlesSchema,
  hiddenBooksSchema,
  type DropboxTitles,
  type HiddenBooks,
  type SetDropboxTitlesRequest,
} from "../../shared/schemas/shelf";
import {
  dropboxFolderListingSchema,
  dropboxSettingsSchema,
  type DropboxFile,
  type DropboxFolderListing,
} from "../../shared/schemas/dropbox";

/** Read by SWR, so a refusal belongs in its `error` state: this one throws. */
const fetchBooks = () => fetcher(SHELF_KEY, bookListSchema).then((data) => data.books);

/** Removes a book. A write, so its failure comes back in the value. */
export type DeleteBook = (id: string) => ResultAsync<unknown, ApiError>;

const requestBookDeletion: DeleteBook = (id) =>
  resultFetcher(`/api/pdf/${id}`, bookDeletedSchema, { method: "DELETE" });

/** Gives a book a title of the reader's own, or (null) takes it away. A write. */
export type RenameBook = (id: string, title: string | null) => ResultAsync<BookRenamed, ApiError>;

const requestRename: RenameBook = (id, title) =>
  resultFetcher(`/api/pdf/${id}`, bookRenamedSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title } satisfies RenameBookRequest),
  });

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

/** Cache key of the entries the reader has put away. */
const HIDDEN_KEY = "/api/shelf/hidden";

const fetchHidden = () => fetcher(HIDDEN_KEY, hiddenBooksSchema);

/** Puts books away or brings them back; answers with everything now put away. */
export type SetHidden = (keys: string[], hidden: boolean) => ResultAsync<HiddenBooks, ApiError>;

const requestHidden: SetHidden = (keys, hidden) =>
  resultFetcher(HIDDEN_KEY, hiddenBooksSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys, hidden }),
  });

/** Cache key of the titles the reader gave Dropbox files not brought in yet. */
const TITLES_KEY = "/api/shelf/titles";

const fetchDropboxTitles = () => fetcher(TITLES_KEY, dropboxTitlesSchema);

/**
 * Gives Dropbox files that are not books yet a title, or (null) takes it away;
 * answers with every such title.
 */
export type SetDropboxTitles = (
  keys: string[],
  title: string | null,
) => ResultAsync<DropboxTitles, ApiError>;

const requestDropboxTitles: SetDropboxTitles = (keys, title) =>
  resultFetcher(TITLES_KEY, dropboxTitlesSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys, title } satisfies SetDropboxTitlesRequest),
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
  loadHidden?: () => Promise<HiddenBooks>;
  setHidden?: SetHidden;
  renameBook?: RenameBook;
  loadDropboxTitles?: () => Promise<DropboxTitles>;
  setDropboxTitles?: SetDropboxTitles;
  /** Injectable so a test can stand in for OCR and its own queue. */
  readByOcr?: ReadStoredBookByOcr;
  saveOcr?: SaveOcr;
  ocrQueue?: OcrQueue;
}

/**
 * How far a chosen file has got, as the shelf tells the reader about it.
 *
 * Three states rather than a share alone: the reading happens before anything
 * has been sent, and once the whole body is up there is still the server
 * writing it away — a bar sat at 0% or at 100% for either of those reads as a
 * shelf that has hung. OCR is not one of them: a book of pictures is stored
 * first and read afterwards in the background, which the shelf shows on the
 * book's own entry (`OcrNotice`).
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

const FORMAT_LABEL: Record<BookFormat, string> = { pdf: "PDF", epub: "EPUB" };

/**
 * How long a book is, in what it is made of: an EPUB has no pages of its own,
 * and what the reader turns through there is its chapters.
 */
function bookLength(book: BookSummary): string {
  return book.format === "epub" ? `${book.pageCount} 章` : `${book.pageCount} ページ`;
}

/** The books of an entry — the part of it a deletion can reach. */
function booksOf(group: ShelfGroup): BookSummary[] {
  return group.members.flatMap((m) => (m.kind === "book" ? [m.book] : []));
}

/** The first book with a cover to show, if any. */
function coverOf(group: ShelfGroup): BookSummary | undefined {
  return booksOf(group).find((b) => b.hasThumbnail);
}

/** The folder a Dropbox file sits in under the chosen one, or nothing for its top. */
function subfolderOf(file: DropboxFile): string {
  return file.path.slice(0, file.path.lastIndexOf("/"));
}

/** What an entry says under its title when it has a single file. */
function singleMemberCaption(member: ShelfMember): string {
  if (member.kind === "book") return bookLength(member.book);
  const subfolder = subfolderOf(member.file);
  return `${subfolder ? `${subfolder} · ` : ""}未読み込み`;
}

/**
 * Which format the single file of an entry is. An entry of several files says
 * so through its chips; one of a single file has no chips, and would otherwise
 * leave the reader guessing whether it is the PDF or the EPUB.
 */
function FormatBadge({ member }: { member: ShelfMember }) {
  return (
    <span
      className={`mr-1 inline-block rounded border px-1 text-[10px] font-medium leading-4 ${
        member.kind === "dropbox" ? "border-sky-300 text-sky-700" : "border-gray-300 text-gray-600"
      }`}
    >
      {FORMAT_LABEL[member.format]}
    </span>
  );
}

/** What the reader presses to read one file of an entry. */
function memberLabel(title: string, member: ShelfMember): string {
  return member.kind === "dropbox" ? `${title} を Dropbox から開く` : `${title} を開く`;
}

/**
 * How far the reader has got in an entry, as the shelf says it: a share for a
 * title opened before, "unread" for one never opened, and nothing for one that
 * is only files waiting in Dropbox — those already say 未読み込み, and have no
 * reading place to report.
 */
type EntryProgress = { kind: "read"; percent: number } | { kind: "unread" } | null;

function progressOf(group: ShelfGroup): EntryProgress {
  if (!group.members.some((m) => m.kind === "book")) return null;
  const percent = groupProgress(group);
  return percent === null ? { kind: "unread" } : { kind: "read", percent };
}

/**
 * The share read, which the entry's button names as its description. The bar
 * beside it is drawn for the eye only: inside a button its role would not
 * reach a screen reader, so the words carry it.
 */
function ProgressText({ id, progress }: { id: string; progress: EntryProgress }) {
  if (progress === null) return null;
  if (progress.kind === "unread") {
    return (
      <span
        id={id}
        className="inline-block rounded-sm bg-amber-400 px-1 text-[10px] font-bold leading-4 text-amber-950"
      >
        未読
      </span>
    );
  }
  return (
    <span id={id} className="font-medium text-gray-700">
      {progress.percent}%<span className="sr-only">読了</span>
    </span>
  );
}

/** A thin track filled as far as the reader has got, Kindle-like. */
function ProgressBar({ percent, className }: { percent: number; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-1 overflow-hidden rounded-full bg-gray-200 ${className}`}
    >
      <span
        data-progress
        className="block h-full rounded-full bg-gray-700"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

/**
 * Where an entry's book stands with OCR, under its title, with the way to stop
 * the reading or start it again. Nothing for an entry with no book waiting.
 *
 * Out of the entry's open button, as the buttons here could not sit in it.
 */
function OcrNotice({ group, ocr }: { group: ShelfGroup; ocr: BackgroundOcr }) {
  const waiting = booksOf(group).filter((b) => b.ocrPending || ocr.jobs.has(b.id));
  if (waiting.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-1">
      {waiting.map((book) => {
        const job = ocr.jobs.get(book.id);
        return (
          <div key={book.id} className="text-xs text-gray-600">
            <p role="status" className="truncate">
              {ocrWording(job)}
            </p>
            {job?.phase === "reading" && job.total > 0 && (
              <span
                aria-hidden="true"
                className="mt-0.5 block h-1 overflow-hidden rounded-full bg-sky-100"
              >
                <span
                  className="block h-full rounded-full bg-sky-600"
                  style={{ width: `${Math.round((job.done / job.total) * 100)}%` }}
                />
              </span>
            )}
            {/* Named apart from 「開く」「削除」「非表示」, which are reached for by
                partial name. */}
            {ocrRunning(job) && (
              <button
                type="button"
                aria-label={`${group.title} の文字の読み取りを中止`}
                onClick={() => ocr.cancel(book.id)}
                className="mt-0.5 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                中止
              </button>
            )}
            {ocrStopped(job) && (
              <button
                type="button"
                aria-label={`${group.title} の文字の読み取りを再開`}
                onClick={() => ocr.start(book.id)}
                className="mt-0.5 rounded border border-sky-300 bg-white px-1.5 py-0.5 text-[11px] text-sky-700 cursor-pointer hover:bg-sky-50"
              >
                再開
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface EntryActions {
  ocr: BackgroundOcr;
  onOpen: (member: ShelfMember) => void;
  onHide: (group: ShelfGroup) => void;
  onDelete: (books: BookSummary[]) => void;
  onRename: (group: ShelfGroup) => void;
}

/**
 * The buttons of an entry that are not "open". Hiding and renaming are always
 * there — a file waiting in Dropbox keeps the title the reader gives it apart
 * from its name, which is the file system's and is left alone. Deleting only
 * where the entry holds a book: the Dropbox file is not ours to delete.
 */
function EntryButtons({
  group,
  onHide,
  onDelete,
  onRename,
  className,
  buttonClassName,
  hideClassName,
}: {
  group: ShelfGroup;
  onHide: EntryActions["onHide"];
  onDelete: EntryActions["onDelete"];
  onRename: EntryActions["onRename"];
  className: string;
  buttonClassName: string;
  hideClassName: string;
}) {
  const books = booksOf(group);
  return (
    <div className={className}>
      {/* Named apart from 「非表示」「削除」「開く」, which the tests and the
          E2E reach for by partial name. */}
      <button
        type="button"
        aria-label={`${group.title} の題名を変更`}
        onClick={() => onRename(group)}
        className={`${buttonClassName} ${hideClassName}`}
      >
        <span aria-hidden="true">✎</span>
      </button>
      <button
        type="button"
        aria-label={`${group.title} を非表示`}
        onClick={() => onHide(group)}
        className={`${buttonClassName} ${hideClassName}`}
      >
        非表示
      </button>
      {books.length > 0 && (
        <button
          type="button"
          aria-label={`${group.title} を削除`}
          onClick={() => onDelete(books)}
          className={buttonClassName}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The files of an entry that holds more than one, each a button of its own.
 * The cover and title open the first; these open the others.
 */
function FormatChips({ group, onOpen }: { group: ShelfGroup } & Pick<EntryActions, "onOpen">) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {group.members.map((member) => (
        <button
          key={member.key}
          type="button"
          aria-label={`${group.title} を ${FORMAT_LABEL[member.format]} で開く${
            member.kind === "dropbox" ? "（Dropbox・未読み込み）" : ""
          }`}
          onClick={() => onOpen(member)}
          className={`rounded border px-1.5 py-0.5 text-[11px] font-medium cursor-pointer ${
            member.kind === "dropbox"
              ? "border-sky-300 text-sky-700 hover:bg-sky-50"
              : "border-gray-300 text-gray-700 hover:bg-gray-100"
          }`}
        >
          {FORMAT_LABEL[member.format]}
        </button>
      ))}
    </div>
  );
}

/**
 * One title on the shelf, however many files it is in. The cover and title open
 * the first file; when there are more, a chip per file opens each.
 */
function GroupCard({
  group,
  ocr,
  onOpen,
  onHide,
  onDelete,
  onRename,
}: { group: ShelfGroup } & EntryActions) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverOf(group);
  const showCover = cover !== undefined && !coverFailed;
  const primary = group.members[0];
  const single = group.members.length === 1;
  const onlyDropbox = group.members.every((m) => m.kind === "dropbox");
  const progress = progressOf(group);
  const progressId = useId();

  return (
    <div className="relative group/card">
      <button
        type="button"
        aria-label={memberLabel(group.title, primary)}
        aria-describedby={progress ? progressId : undefined}
        onClick={() => onOpen(primary)}
        className="group flex w-full flex-col text-left cursor-pointer focus:outline-none"
      >
        <div
          className={`relative aspect-3/4 w-full overflow-hidden rounded-r-md rounded-l-sm border-l-4 shadow-md transition-all group-hover:-translate-y-1 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-blue-500 ${
            onlyDropbox ? "border-sky-300" : "border-gray-300 bg-gray-100"
          }`}
        >
          {showCover ? (
            <img
              src={`/api/pdf/${cover.id}/thumbnail`}
              alt={`${group.title} の表紙`}
              loading="lazy"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center p-3 bg-linear-to-br ${
                onlyDropbox ? "from-sky-500 to-blue-700" : "from-slate-600 to-slate-800"
              }`}
            >
              <span className="line-clamp-5 text-center text-xs font-medium text-white/90">
                {group.title}
              </span>
            </div>
          )}
          {onlyDropbox && (
            <span className="absolute left-1.5 top-1.5 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              Dropbox
            </span>
          )}
          {progress?.kind === "unread" && (
            // Kindle's "NEW", in the bottom corner: on a phone the buttons are
            // always out and, a thumb wide each, fill the whole top of the cover.
            <span className="absolute bottom-1.5 left-1.5">
              <ProgressText id={progressId} progress={progress} />
            </span>
          )}
        </div>
        {progress?.kind === "read" && (
          <ProgressBar percent={progress.percent} className="mt-1.5 w-full" />
        )}
        <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-800">{group.title}</p>
        {(progress?.kind === "read" || single) && (
          <p className="truncate text-xs text-gray-500">
            {single && <FormatBadge member={primary} />}
            {progress?.kind === "read" && <ProgressText id={progressId} progress={progress} />}
            {progress?.kind === "read" && single && " · "}
            {single && singleMemberCaption(primary)}
          </p>
        )}
      </button>
      {!single && <FormatChips group={group} onOpen={onOpen} />}
      <OcrNotice group={group} ocr={ocr} />

      {/* Kept out of the way until the pointer arrives — but only where there
          is a pointer to arrive. A finger never hovers, so on a touch-sized
          screen the buttons are simply there, at a size a thumb can hit. */}
      <EntryButtons
        group={group}
        onHide={onHide}
        onDelete={onDelete}
        onRename={onRename}
        className="absolute right-1.5 top-1.5 flex gap-1 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover/card:opacity-100 [@media(hover:none)]:opacity-100"
        buttonClassName="flex h-11 items-center justify-center rounded-full bg-black/55 px-3 text-lg leading-normal text-white cursor-pointer hover:bg-red-600 md:h-auto md:px-2 md:py-0.5 md:text-sm"
        hideClassName="!text-xs hover:!bg-gray-700"
      />
    </div>
  );
}

/** The compact shelf's entry: a small cover, the title and its length on one row. */
function GroupRow({
  group,
  ocr,
  onOpen,
  onHide,
  onDelete,
  onRename,
}: { group: ShelfGroup } & EntryActions) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverOf(group);
  const showCover = cover !== undefined && !coverFailed;
  const primary = group.members[0];
  const single = group.members.length === 1;
  const progress = progressOf(group);
  const progressId = useId();

  return (
    <div className="flex items-center rounded-md border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40">
      <button
        type="button"
        aria-label={memberLabel(group.title, primary)}
        aria-describedby={progress ? progressId : undefined}
        onClick={() => onOpen(primary)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-2 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div className="h-12 w-9 shrink-0 overflow-hidden rounded-sm border-l-2 border-gray-300 bg-slate-700">
          {showCover && (
            <img
              src={`/api/pdf/${cover.id}/thumbnail`}
              alt=""
              loading="lazy"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800">{group.title}</span>
          {(progress || single) && (
            <span className="block truncate text-xs text-gray-500">
              {single && <FormatBadge member={primary} />}
              <ProgressText id={progressId} progress={progress} />
              {progress && single && " · "}
              {single && singleMemberCaption(primary)}
            </span>
          )}
          {progress?.kind === "read" && (
            <ProgressBar percent={progress.percent} className="mt-1 w-full max-w-40" />
          )}
        </span>
      </button>
      {!single && <FormatChips group={group} onOpen={onOpen} />}
      <div className="max-w-44 shrink-0">
        <OcrNotice group={group} ocr={ocr} />
      </div>
      {/* Always shown: a row has room for it, and a finger never hovers. */}
      <EntryButtons
        group={group}
        onHide={onHide}
        onDelete={onDelete}
        onRename={onRename}
        className="ml-1 flex shrink-0 items-center gap-1 pr-1"
        buttonClassName="flex h-11 min-w-11 items-center justify-center rounded-full text-lg text-gray-400 cursor-pointer hover:bg-red-50 hover:text-red-600"
        hideClassName="!px-2 !text-xs hover:!bg-gray-100 hover:!text-gray-700"
      />
    </div>
  );
}

/** One row of the list of hidden books, with the way back to the shelf. */
function HiddenRow({ group, onShow }: { group: ShelfGroup; onShow: (group: ShelfGroup) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-2 pl-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-800">{group.title}</span>
        <span className="block text-xs text-gray-500">
          {group.members.map((m) => FORMAT_LABEL[m.format]).join(" / ")}
        </span>
      </span>
      <button
        type="button"
        aria-label={`${group.title} を表示に戻す`}
        onClick={() => onShow(group)}
        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
      >
        表示に戻す
      </button>
    </li>
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
  compact,
}: {
  onFileChosen: (file: File) => void;
  disabled: boolean;
  compact: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed ${
          compact ? "h-16 flex-row" : "aspect-3/4 flex-col"
        } border-gray-300 bg-white/40 text-gray-500 transition-colors cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:bg-white/40 disabled:hover:text-gray-500`}
      >
        <span
          aria-hidden="true"
          className={compact ? "text-xl leading-none" : "text-3xl leading-none"}
        >
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
  loadHidden = fetchHidden,
  setHidden = requestHidden,
  renameBook = requestRename,
  loadDropboxTitles = fetchDropboxTitles,
  setDropboxTitles = requestDropboxTitles,
  readByOcr,
  saveOcr,
  ocrQueue,
}: ShelfPageProps = {}) {
  const navigate = useNavigate();
  const { mutate: mutateKey } = useSWRConfig();
  const { data: books, error: loadError, mutate } = useSWR(SHELF_KEY, loadBooks);
  const {
    data: dropbox,
    error: dropboxError,
    mutate: mutateDropbox,
  } = useSWR(DROPBOX_KEY, loadDropboxFolder);
  const dropboxFiles = dropbox?.state === "ready" ? dropbox.files : [];
  const [choosingFolder, setChoosingFolder] = useState(false);
  const { data: hidden, error: hiddenError, mutate: mutateHidden } = useSWR(HIDDEN_KEY, loadHidden);
  // Read apart from the shelf, like the hidden books: until they arrive (or
  // when they cannot be read) the Dropbox files go by their file names.
  const {
    data: dropboxTitles,
    error: titlesError,
    mutate: mutateTitles,
  } = useSWR(TITLES_KEY, loadDropboxTitles);
  const fileTitles = useMemo(
    () => new Map((dropboxTitles?.titles ?? []).map((t) => [t.key, t.title])),
    [dropboxTitles],
  );
  // Whether the list of books put away is what the page shows, in place of the shelf.
  const [showingHidden, setShowingHidden] = useState(false);
  // Which file of a title its card opens, when there is a PDF and an EPUB of it.
  const preferredFormat = useAtomValue(preferredFormatAtom);
  // Until the list arrives nothing is taken to be put away: the shelf does not
  // wait for it, and one that could not be read leaves every book in view.
  const { shown, hidden: putAway } = useMemo(
    () =>
      splitHidden(
        groupShelf(books ?? [], dropboxFiles, preferredFormat, fileTitles),
        new Set(hidden?.keys ?? []),
      ),
    [books, dropboxFiles, hidden, preferredFormat, fileTitles],
  );
  // What the reader typed to find a book. Narrowed on every keystroke, input
  // method composition included: it is a filter over what is already here, so
  // a half-converted word costs nothing and breaks nothing.
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterShelf(shown, query), [shown, query]);
  const visibleHidden = useMemo(() => filterShelf(putAway, query), [putAway, query]);
  const noMatch = `「${query.trim()}」に一致する本はありません`;
  const [layout, setLayout] = useAtom(shelfLayoutAtom);
  const compact = layout === "compact";
  const [importing, setImporting] = useState<Importing | null>(null);
  const ocr = useBackgroundOcr({ read: readByOcr, save: saveOcr, queue: ocrQueue });
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
  // The entry whose title the reader is changing, while its dialog is open.
  const [renaming, setRenaming] = useState<ShelfGroup | null>(null);
  // The books of the entry the reader pressed × on, all of which go together.
  const [booksPendingDeletion, setBooksPendingDeletion] = useState<BookSummary[] | null>(null);
  // How many elements of the shelf the drag is currently inside. Every card it
  // passes over sends a leave of its own, so a plain boolean would flicker off
  // halfway across the shelf.
  const [dragDepth, setDragDepth] = useState(0);

  const error =
    actionError ??
    (loadError ? `本棚の読み込みに失敗しました: ${(loadError as Error).message}` : null) ??
    (hiddenError
      ? `非表示の本の一覧を読めませんでした: ${(hiddenError as Error).message}`
      : null) ??
    (titlesError ? `Dropboxの本の題名を読めませんでした: ${(titlesError as Error).message}` : null);

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
      (stored) => opened(stored, file),
      (failure) => importFailed(failure, "本を開けませんでした"),
    );
  };

  /**
   * Leaves for a book just stored — starting, for a book of pictures, the OCR
   * that reads its text in the background. It is handed the file the reader
   * has here, so the reading does not download what was just sent up.
   */
  const opened = (stored: StoredBook, file: File) => {
    if (stored.ocrPending) ocr.start(stored.id, file);
    // Read again now, while the shelf is still here to ask: a reader who comes
    // straight back finds the book there, rather than the list from before it
    // was added — a remount within SWR's deduping interval asks nobody.
    void mutate();
    void openBook(stored.id);
  };

  /** Hands the shelf back after an import that did not become a book. */
  const importFailed = (failure: Error, lead: string) => {
    setImporting(null);
    setActionError(`${lead}: ${failure.message}`);
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
      return openFile(file, { dropboxId: entry.dropboxId }).map((stored) => ({ stored, file }));
    });
    outcome.match(
      ({ stored, file }) => opened(stored, file),
      (failure) => importFailed(failure, "Dropboxの本を開けませんでした"),
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

  const openMember = (member: ShelfMember) =>
    member.kind === "book" ? openBook(member.book.id) : void handleDropboxFile(member.file);

  /** Removes every book of an entry, stopping at the first the server refuses. */
  const removeBooks = async (doomed: BookSummary[]) => {
    setActionError(null);
    setBooksPendingDeletion(null);

    const gone = new Set<string>();
    let failure: string | null = null;
    for (const book of doomed) {
      const removal = await deleteBook(book.id);
      if (removal.isErr()) {
        failure = `削除に失敗しました: ${removal.error.message}`;
        break;
      }
      gone.add(book.id);
      // A book that is gone has no text left to read into
      ocr.cancel(book.id);
    }

    // The server has already dropped these, so re-reading the shelf would only
    // confirm what this list can work out for itself.
    if (gone.size > 0) {
      await mutate((current) => current?.filter((b) => !gone.has(b.id)), { revalidate: false });
      // Their Dropbox files are still in the folder, and go back to waiting
      // there — under the titles the books had, which the server handed back
      // to the files.
      if (doomed.some((b) => gone.has(b.id) && b.inDropbox)) {
        void mutateDropbox();
        if (doomed.some((b) => gone.has(b.id) && b.inDropbox && b.title !== null)) {
          void mutateTitles();
        }
      }
    }
    if (failure) setActionError(failure);
  };

  /** Puts an entry away or brings it back — every file in it, so it moves as one. */
  const setGroupHidden = async (group: ShelfGroup, hide: boolean) => {
    setActionError(null);
    const result = await setHidden(
      group.members.map((m) => m.key),
      hide,
    );
    result.match(
      (now) => void mutateHidden(now, { revalidate: false }),
      (failure) =>
        setActionError(
          `${hide ? "非表示にする" : "表示に戻す"}ことに失敗しました: ${failure.message}`,
        ),
    );
  };

  /**
   * Gives every file of an entry the same title — the entry is one book to the
   * reader, and renaming only one of its files would split it in two
   * (`groupShelf` gathers renamed files by their title). The books are renamed
   * one by one (`PATCH /api/pdf/:pdfId`), then the Dropbox files not brought in
   * yet all at once (`PUT /api/shelf/titles`). Stops at the first refusal, and
   * hands it back for the dialog to show.
   *
   * What the server took is written into the caches the title is read from —
   * the shelf, the book the reader opens, and the Dropbox files' titles —
   * rather than read again: the answers already say what each title now is.
   */
  const renameGroup = (group: ShelfGroup, title: string | null): ResultAsync<void, ApiError> =>
    ResultAsync.fromSafePromise(
      (async () => {
        const renamed: BookRenamed[] = [];
        for (const book of booksOf(group)) {
          const result = await renameBook(book.id, title);
          if (result.isErr()) return { renamed, failure: result.error };
          renamed.push(result.value);
        }
        const fileKeys = group.members.flatMap((m) => (m.kind === "dropbox" ? [m.key] : []));
        if (fileKeys.length > 0) {
          const result = await setDropboxTitles(fileKeys, title);
          if (result.isErr()) return { renamed, failure: result.error };
          void mutateTitles(result.value, { revalidate: false });
        }
        return { renamed, failure: null };
      })(),
    ).andThen(({ renamed, failure }) => {
      if (renamed.length > 0) {
        const titles = new Map(renamed.map((r) => [r.id, r.title]));
        void mutate(
          (current) =>
            current?.map((b) => (titles.has(b.id) ? { ...b, title: titles.get(b.id) ?? null } : b)),
          { revalidate: false },
        );
        for (const { id, title: stored } of renamed) {
          void mutateKey<BookDetail>(
            bookKey(id),
            (current) => (current ? { ...current, title: stored } : current),
            { revalidate: false },
          );
        }
      }
      return failure ? errAsync(failure) : okAsync(undefined);
    });

  const entryActions = {
    ocr,
    onOpen: openMember,
    onHide: (group: ShelfGroup) => void setGroupHidden(group, true),
    onDelete: setBooksPendingDeletion,
    onRename: setRenaming,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4">
        <h1 className="text-lg font-bold text-gray-800">chatbook</h1>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {(putAway.length > 0 || showingHidden) && (
            <button
              type="button"
              aria-pressed={showingHidden}
              onClick={() => setShowingHidden(!showingHidden)}
              className="shrink-0 rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 aria-pressed:border-blue-400 aria-pressed:bg-blue-50 aria-pressed:text-blue-700"
            >
              非表示の本 ({putAway.length})
            </button>
          )}
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => setLayout(compact ? "grid" : "compact")}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 aria-pressed:border-blue-400 aria-pressed:bg-blue-50 aria-pressed:text-blue-700"
          >
            コンパクト表示
          </button>
          {/* Only where the deploy holds Dropbox credentials. A folder that
              could not be read is still something to change from here. */}
          <ShelfSettingsMenu
            dropbox={
              dropboxError || (dropbox && dropbox.state !== "unavailable")
                ? { folder: dropbox?.state === "ready" ? dropbox.folder : null }
                : null
            }
            onChooseFolder={() => setChoosingFolder(true)}
          />
        </div>
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

        {/* Out of the header: on a phone it already holds its buttons. */}
        {(shown.length > 0 || putAway.length > 0 || query !== "") && (
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <input
              type="search"
              aria-label="本棚を検索"
              placeholder="題名で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        )}

        {showingHidden && (
          <section aria-label="非表示の本">
            <p className="mb-3 text-sm text-gray-500">
              本棚に出していない本です。「表示に戻す」で本棚に戻ります。
            </p>
            {putAway.length === 0 ? (
              <p className="text-sm text-gray-500">非表示の本はありません</p>
            ) : visibleHidden.length === 0 ? (
              <p className="text-sm text-gray-500">{noMatch}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {visibleHidden.map((group) => (
                  <HiddenRow
                    key={group.id}
                    group={group}
                    onShow={(g) => setGroupHidden(g, false)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {!showingHidden && books?.length === 0 && dropboxFiles.length === 0 && (
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
        {!showingHidden && shown.length > 0 && visible.length === 0 && (
          <p className="mb-4 text-sm text-gray-500">{noMatch}</p>
        )}

        {!showingHidden && (
          <ul
            className={
              compact
                ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                : "grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-5"
            }
          >
            {visible.map((group) => (
              <li key={group.id}>
                {compact ? (
                  <GroupRow {...entryActions} group={group} />
                ) : (
                  <GroupCard {...entryActions} group={group} />
                )}
              </li>
            ))}
            <li>
              <AddBookTile
                onFileChosen={handleFile}
                disabled={importing !== null}
                compact={compact}
              />
            </li>
          </ul>
        )}
      </main>

      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70">
          <div className="flex flex-col items-center gap-4">
            <p role="status" className="text-lg text-gray-600">
              {importWording(importing)}
            </p>
          </div>
        </div>
      )}

      {booksPendingDeletion && (
        <ConfirmDialog
          message={
            (booksPendingDeletion.length === 1
              ? `「${bookTitle(booksPendingDeletion[0])}」を削除しますか？`
              : `「${bookTitle(booksPendingDeletion[0])}」の${booksPendingDeletion
                  .map((b) => (b.format === "epub" ? "EPUB" : "PDF"))
                  .join("・")}をすべて削除しますか？`) +
            "ハイライトとチャット履歴も削除されます。" +
            (booksPendingDeletion.some((b) => b.inDropbox)
              ? "Dropbox のファイルは削除されず、未読み込みの本として本棚に残ります。"
              : "")
          }
          dialogLabel="本の削除"
          confirmLabel="削除する"
          onConfirm={() => removeBooks(booksPendingDeletion)}
          onCancel={() => setBooksPendingDeletion(null)}
        />
      )}

      {renaming && (
        <BookTitleDialog
          current={renaming.title}
          save={(title) => renameGroup(renaming, title)}
          onSaved={() => setRenaming(null)}
          onCancel={() => setRenaming(null)}
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
