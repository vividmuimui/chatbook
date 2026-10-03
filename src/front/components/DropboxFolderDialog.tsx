import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../lib/fetcher";
import { normalizeDropboxFolder, type DropboxSettings } from "../../shared/schemas/dropbox";

/** Stores the folder the shelf reads. A write, so its failure comes back in the value. */
export type SaveDropboxFolder = (folder: string) => ResultAsync<DropboxSettings, ApiError>;

interface DropboxFolderDialogProps {
  /** The folder chosen now, or null when there is none yet. */
  current: string | null;
  save: SaveDropboxFolder;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Where the reader says which Dropbox folder holds their books.
 *
 * A path rather than a folder browser: one person sets this once, and they know
 * where their books are. The server checks the folder exists before keeping it,
 * and what it says when it does not stays in the dialog, next to what was typed.
 */
export function DropboxFolderDialog({
  current,
  save,
  onSaved,
  onCancel,
}: DropboxFolderDialogProps) {
  const [folder, setFolder] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // Caught here rather than by a round trip: an empty path is not a folder.
    if (normalizeDropboxFolder(folder) === null) {
      setError("フォルダのパスを入力してください（例: /Books）");
      return;
    }
    setSaving(true);
    setError(null);

    const saved = await save(folder);
    saved.match(
      () => onSaved(),
      (failure) => {
        setSaving(false);
        setError(
          failure.code === "DROPBOX_FOLDER_NOT_FOUND"
            ? "Dropbox にそのフォルダがありません"
            : `保存できませんでした: ${failure.message}`,
        );
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
        aria-label="Dropbox フォルダの設定"
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
      >
        <label className="block text-sm font-medium text-gray-800">
          本を置いている Dropbox のフォルダ
          <input
            type="text"
            autoFocus
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="/Books"
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-base font-normal focus:border-blue-500 focus:outline-none sm:text-sm"
          />
        </label>
        <p className="mt-2 text-xs text-gray-500">
          このフォルダとその下のフォルダにある PDF
          が本棚に並び、追加した本はこのフォルダに保存されます。
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
            {saving ? "確認中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
