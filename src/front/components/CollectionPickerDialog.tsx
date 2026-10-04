import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../lib/fetcher";
import { MAX_COLLECTION_NAME_LENGTH, type Collection } from "../../shared/schemas/shelf";

interface CollectionPickerDialogProps {
  /** The entry being filed, as the shelf calls it. */
  title: string;
  /** Every collection, in the shelf's order. */
  collections: Collection[];
  /** The collections the entry is in now — read from the cache, so it follows each write. */
  memberOf: ReadonlySet<string>;
  /** Puts the entry in a collection, or takes it out. A write. */
  setMember: (collectionId: string, member: boolean) => ResultAsync<unknown, ApiError>;
  /** Makes a collection with the entry already in it. A write. */
  create: (name: string) => ResultAsync<unknown, ApiError>;
  onClose: () => void;
}

/**
 * Where the reader puts an entry in collections and takes it out, a checkbox per
 * collection. Each tick is stored at once — there is no "save" to forget — and
 * a new collection made here has the entry in it from the start.
 *
 * A refusal is said here, with the dialog left open: the ticks show what the
 * server holds (they are read from its answer), so a write that failed leaves
 * its box as it was.
 */
export function CollectionPickerDialog({
  title,
  collections,
  memberOf,
  setMember,
  create,
  onClose,
}: CollectionPickerDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const run = async (write: () => ResultAsync<unknown, ApiError>, onDone?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await write();
    setBusy(false);
    result.match(
      () => onDone?.(),
      (failure) => setError(`コレクションを変更できませんでした: ${failure.message}`),
    );
  };

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="コレクションに入れる"
        className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-lg bg-white p-5 shadow-xl"
      >
        <p className="text-sm font-medium text-gray-800">「{title}」を入れるコレクション</p>

        {collections.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">まだコレクションがありません</p>
        ) : (
          <ul className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {collections.map((collection) => (
              <li key={collection.id}>
                <label className="flex min-h-11 items-center gap-3 rounded px-1 text-sm text-gray-800 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={memberOf.has(collection.id)}
                    disabled={busy}
                    onChange={(e) => {
                      const member = e.target.checked;
                      void run(() => setMember(collection.id, member));
                    }}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">{collection.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-3 flex gap-2 border-t border-gray-100 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() === "") return;
            void run(
              () => create(name.trim()),
              () => setName(""),
            );
          }}
        >
          <input
            type="text"
            aria-label="新しいコレクションの名前"
            placeholder="新しいコレクション"
            value={name}
            maxLength={MAX_COLLECTION_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-base focus:border-blue-500 focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={busy || name.trim() === ""}
            className="shrink-0 rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 cursor-pointer hover:bg-blue-50 disabled:cursor-default disabled:opacity-50"
          >
            作成して入れる
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
