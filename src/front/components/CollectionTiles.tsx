import type { Collection } from "../../shared/schemas/shelf";

/** One tile of the collections view: a collection, or 未分類. */
export interface CollectionTile {
  /** The collection's id, or `UNFILED`. */
  id: string;
  name: string;
  /** How many entries of the shelf it holds — hidden ones left out. */
  count: number;
  /** The books whose covers the tile stacks, up to four. */
  covers: string[];
}

/** What stands for 未分類 where a collection's id would go — the URL's `?collection=`. */
export const UNFILED = "unfiled";

/**
 * The collections, a tile each, with 未分類 after them and the way to make a
 * new one last — where the shelf keeps its "本を追加".
 *
 * A tile is named 「コレクション「…」を開く」 rather than after the collection
 * alone: a collection may be called anything, and a name like a book's would
 * be matched by the tests and the E2E reaching for that book's 「… を開く」.
 */
export function CollectionTiles({
  tiles,
  unfiled,
  onOpen,
  onCreate,
}: {
  tiles: CollectionTile[];
  unfiled: CollectionTile;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <ul
      aria-label="コレクション"
      className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-5"
    >
      {[...tiles, unfiled].map((tile) => (
        <li key={tile.id}>
          <button
            type="button"
            aria-label={
              tile.id === UNFILED ? "未分類の本を開く" : `コレクション「${tile.name}」を開く`
            }
            onClick={() => onOpen(tile.id)}
            className="group flex w-full flex-col text-left cursor-pointer focus:outline-none"
          >
            <CoverStack covers={tile.covers} unfiled={tile.id === UNFILED} />
            <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-800">{tile.name}</p>
            <p className="text-xs text-gray-500">{tile.count} 冊</p>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onCreate}
          className="flex aspect-3/4 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-gray-300 bg-white/40 text-gray-500 transition-colors cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
        >
          <span aria-hidden="true" className="text-3xl leading-none">
            ＋
          </span>
          <span className="text-sm font-medium">新しいコレクション</span>
        </button>
      </li>
    </ul>
  );
}

/**
 * Heads the shelf while one collection's books are what it lists: the way back
 * to the tiles, the collection's name, and — for a collection of the reader's,
 * not 未分類 — renaming and deleting it.
 *
 * The two are named 「コレクションの…」 rather than after the collection, and
 * deleting it does not end in を削除: the E2E reaches for an entry's × by
 * `/を削除$/`.
 */
export function CollectionHeader({
  collection,
  count,
  onBack,
  onRename,
  onDelete,
}: {
  collection: Collection | typeof UNFILED;
  count: number;
  onBack: () => void;
  onRename: (collection: Collection) => void;
  onDelete: (collection: Collection) => void;
}) {
  const name = collection === UNFILED ? "未分類" : collection.name;
  const buttonClassName =
    "shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 cursor-pointer hover:bg-gray-100";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={onBack}
        className="shrink-0 rounded-md px-1 py-1 text-sm text-blue-700 cursor-pointer hover:underline"
      >
        ← コレクション
      </button>
      <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-gray-800">
        {name}
        <span className="ml-2 text-sm font-normal text-gray-500">{count} 冊</span>
      </h2>
      {collection !== UNFILED && (
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="コレクションの名前を変更"
            onClick={() => onRename(collection)}
            className={buttonClassName}
          >
            名前を変更
          </button>
          <button
            type="button"
            aria-label="コレクションの削除"
            onClick={() => onDelete(collection)}
            className={`${buttonClassName} hover:border-red-300 hover:bg-red-50 hover:text-red-600`}
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Up to four covers of what the collection holds, two by two, Kindle-like. A
 * cell with no cover is a plain block, so an empty collection still reads as a
 * place for books rather than a gap.
 */
function CoverStack({ covers, unfiled }: { covers: string[]; unfiled: boolean }) {
  return (
    <div
      className={`grid aspect-3/4 w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-md p-1.5 shadow-md transition-all group-hover:-translate-y-1 group-hover:shadow-xl group-focus-visible:ring-2 group-focus-visible:ring-blue-500 ${
        unfiled ? "bg-gray-200" : "bg-slate-700"
      }`}
    >
      {Array.from({ length: 4 }, (_, i) => {
        const cover = covers[i];
        return cover ? (
          <img
            key={cover}
            src={`/api/pdf/${cover}/thumbnail`}
            alt=""
            loading="lazy"
            className="h-full w-full rounded-sm object-cover"
          />
        ) : (
          <span
            key={`empty-${i}`}
            className={`block rounded-sm ${unfiled ? "bg-gray-300/70" : "bg-slate-600/70"}`}
          />
        );
      })}
    </div>
  );
}
