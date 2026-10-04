import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../lib/fetcher";
import { MAX_COLLECTION_NAME_LENGTH } from "../../shared/schemas/shelf";

interface CollectionNameDialogProps {
  /** "新しいコレクション" or "コレクションの名前を変更" — the dialog's own name. */
  label: string;
  /** The name the box starts from: the collection's, or nothing for a new one. */
  current: string;
  /** "作成" or "保存". */
  submitLabel: string;
  /** Stores the name. A write, so its failure comes back in the value. */
  save: (name: string) => ResultAsync<unknown, ApiError>;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Where a collection is named, when it is made and when it is renamed.
 *
 * A blank name is not sent — the server would refuse it — so the button waits
 * for something to be typed. What the server says when it refuses stays here,
 * next to what was typed, the way the title dialog keeps it.
 */
export function CollectionNameDialog({
  label,
  current,
  submitLabel,
  save,
  onSaved,
  onCancel,
}: CollectionNameDialogProps) {
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = name.trim() === "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || blank) return;
    setSaving(true);
    setError(null);

    const saved = await save(name.trim());
    saved.match(
      () => onSaved(),
      (failure) => {
        setSaving(false);
        setError(`コレクションを保存できませんでした: ${failure.message}`);
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
        aria-label={label}
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <label className="block text-sm font-medium text-gray-800">
          コレクションの名前
          <input
            type="text"
            autoFocus
            value={name}
            maxLength={MAX_COLLECTION_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-base font-normal focus:border-blue-500 focus:outline-none sm:text-sm"
          />
        </label>
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
            disabled={saving || blank}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white cursor-pointer hover:bg-blue-700 disabled:cursor-default disabled:opacity-50"
          >
            {saving ? "保存中..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
