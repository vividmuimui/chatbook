import type { OutlineEntry } from "../../hooks/usePdfOutline";
import type { OutlineGeneration } from "../../hooks/useReaderOutline";
import { findActiveEntry } from "../../lib/pdfOutline";

interface PdfOutlineProps {
  outline: OutlineEntry[] | null;
  /** Why the bookmarks could not be read, if they could not. */
  error: string | null;
  currentPage: number;
  /**
   * Where in the current page the reader is, as a place in its text. An EPUB's
   * page is a whole chapter and its entries are told apart by where in it they
   * start (`OutlineEntry.offset`); a PDF leaves this out.
   */
  currentOffset?: number;
  /** The entry's page, and the place in it an EPUB's entry names (`OutlineEntry.anchor`). */
  onJump: (pageNumber: number, anchor?: string) => void;
  /**
   * What is written beside an entry. The page it starts on unless the book says
   * otherwise: an EPUB's page is a chapter of the file, which tells a reader
   * nothing, so it writes how far into the book the entry is instead.
   */
  entryLabel?: (entry: OutlineEntry & { pageNumber: number }) => string | null;
  /**
   * Having the model make a table of contents, offered under "none" where the
   * book has none. Left out, nothing is offered.
   */
  generation?: OutlineGeneration;
}

const pageLabel = (entry: { pageNumber: number }) => String(entry.pageNumber);

function OutlineItem({
  entry,
  depth,
  activeEntry,
  onJump,
  entryLabel,
}: {
  entry: OutlineEntry;
  depth: number;
  activeEntry: OutlineEntry | null;
  onJump: (pageNumber: number, anchor?: string) => void;
  entryLabel: (entry: OutlineEntry & { pageNumber: number }) => string | null;
}) {
  const isActive = entry === activeEntry;
  const label =
    entry.pageNumber !== null ? entryLabel({ ...entry, pageNumber: entry.pageNumber }) : null;

  return (
    <li>
      <button
        type="button"
        // Said out loud as well as coloured in: this is the only place a wide
        // screen shows how far into the book the reader is.
        aria-current={isActive ? "location" : undefined}
        disabled={entry.pageNumber === null}
        onClick={() => entry.pageNumber !== null && onJump(entry.pageNumber, entry.anchor)}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={`flex w-full items-baseline gap-2 py-1.5 pr-2 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-40 ${
          isActive
            ? "bg-blue-50 font-medium text-blue-700"
            : "text-gray-700 hover:bg-gray-100 cursor-pointer"
        }`}
      >
        <span className="min-w-0 flex-1 break-words">{entry.title}</span>
        {label !== null && <span className="shrink-0 text-[10px] text-gray-400">{label}</span>}
      </button>
      {entry.children.length > 0 && (
        <ul>
          {entry.children.map((child, i) => (
            <OutlineItem
              key={`${child.title}-${i}`}
              entry={child}
              depth={depth + 1}
              activeEntry={activeEntry}
              onJump={onJump}
              entryLabel={entryLabel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function PdfOutline({
  outline,
  error,
  currentPage,
  currentOffset,
  onJump,
  entryLabel = pageLabel,
  generation,
}: PdfOutlineProps) {
  const activeEntry = outline ? findActiveEntry(outline, currentPage, currentOffset) : null;

  return (
    <nav
      aria-label="目次"
      className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white"
    >
      <h2 className="border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500">
        目次
      </h2>

      {error !== null && (
        <p role="alert" className="p-3 text-xs text-red-600">
          目次を読み込めませんでした: {error}
        </p>
      )}

      {outline === null && error === null && (
        <p className="p-3 text-xs text-gray-400">読み込み中...</p>
      )}

      {outline?.length === 0 && (
        <p className="p-3 text-xs text-gray-400">この本には目次がありません</p>
      )}

      {/* Under the "none" it answers: a scanned or exported PDF often ships no
          bookmarks, and the chapters are what both this panel and the chat's
          scope menu are cut by. Left up after a failure, which says why. */}
      {outline?.length === 0 && generation && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => void generation.onGenerate()}
            disabled={generation.generating}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer disabled:cursor-default disabled:opacity-60"
          >
            {generation.generating ? "目次を作成中..." : "AIで目次を作る"}
          </button>
          {generation.error !== null && (
            <p role="alert" className="pt-2 text-xs text-red-600">
              目次を作成できませんでした: {generation.error}
            </p>
          )}
        </div>
      )}

      {outline && outline.length > 0 && (
        <ul className="flex-1 overflow-y-auto py-1">
          {outline.map((entry, i) => (
            <OutlineItem
              key={`${entry.title}-${i}`}
              entry={entry}
              depth={0}
              activeEntry={activeEntry}
              onJump={onJump}
              entryLabel={entryLabel}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
