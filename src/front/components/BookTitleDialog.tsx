import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../lib/fetcher";
import { MAX_BOOK_TITLE_LENGTH } from "../../shared/schemas/book";

interface BookTitleDialogProps {
  /** The title the entry shows now, which the box starts from. */
  current: string;
  /**
   * Stores the title — null to go back to the one the file name makes. A write,
   * so its failure comes back in the value.
   */
  save: (title: string | null) => ResultAsync<unknown, ApiError>;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Where the reader gives a book a title of their own.
 *
 * Emptying the box is how a title is taken away, and the dialog says so: a
 * second button for it would sit next to "save" doing the same thing. What the
 * server says when it refuses stays in the dialog, next to what was typed, so
 * nothing the reader wrote is lost to a failed save.
 */
export function BookTitleDialog({ current, save, onSaved, onCancel }: BookTitleDialogProps) {
  const [title, setTitle] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    const saved = await save(title.trim() === "" ? null : title.trim());
    saved.match(
      () => onSaved(),
      (failure) => {
        setSaving(false);
        setError(`題名を変更できませんでした: ${failure.message}`);
      },
    );
  };

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="題名の変更"
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <label className="block text-sm font-medium text-gray-800">
          題名
          <input
            type="text"
            autoFocus
            value={title}
            // The server's limit, so a title too long to keep cannot be typed
            // rather than being refused after the reader pressed save.
            maxLength={MAX_BOOK_TITLE_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-base font-normal focus:border-blue-500 focus:outline-none sm:text-sm"
          />
        </label>
        <p className="mt-2 text-xs text-gray-500">
          本棚とリーダーにこの題名が出ます。空にするとファイル名の題名に戻ります。
        </p>
        {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white cursor-pointer hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
