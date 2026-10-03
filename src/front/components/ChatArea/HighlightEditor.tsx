import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../../lib/fetcher";
import { ColorSwatches } from "../ColorSwatches";
import { MAX_NOTE_LENGTH, type UpdateSelectionRequest } from "../../../shared/schemas/selection";

interface HighlightEditorProps {
  /** The colour and note as stored, which the editor starts from. */
  color: string;
  note: string | null;
  /** Writes a change; its failure comes back in the value. */
  onChange: (change: UpdateSelectionRequest) => ResultAsync<void, ApiError>;
  onClose: () => void;
}

/**
 * Where a highlight's colour and note are changed after it was made — from the
 * list and from the head of its conversation.
 *
 * A colour is changed the moment a swatch is pressed, the way it was picked in
 * the first place; the note waits for "メモを保存", since half a sentence is
 * not a note. Emptying the field and saving takes the note away.
 *
 * A failure is said here, inside the editor, which stays open with what was
 * typed in it: this is the only place the change was asked for, and the list
 * and the conversation around it have their own failures to show.
 */
export function HighlightEditor({ color, note, onChange, onClose }: HighlightEditorProps) {
  const [draft, setDraft] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (request: UpdateSelectionRequest, then?: () => void) => {
    setBusy(true);
    setError(null);
    const changed = await onChange(request);
    setBusy(false);
    if (changed.isErr()) {
      setError(`変更できませんでした: ${changed.error.message}`);
      return;
    }
    then?.();
  };

  const trimmed = draft.trim();
  const unchanged = trimmed === (note ?? "");

  return (
    <div
      role="group"
      aria-label="メモと色"
      className="flex flex-col gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3"
    >
      <div className="-mx-2">
        <ColorSwatches
          labelOf={(name) => `${name}に変える`}
          selected={color}
          onPick={(picked) => {
            if (picked !== color) void change({ color: picked });
          }}
          disabled={busy}
        />
      </div>
      <textarea
        aria-label="メモ"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="メモを書く（空にして保存すると消えます）"
        maxLength={MAX_NOTE_LENGTH}
        readOnly={busy}
        rows={3}
        className="w-full resize-y rounded-md border border-gray-300 p-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none read-only:bg-gray-100"
      />
      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          やめる
        </button>
        <button
          type="button"
          onClick={() => void change({ note: trimmed === "" ? null : trimmed }, onClose)}
          disabled={busy || unchanged}
          className="cursor-pointer rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          メモを保存
        </button>
      </div>
    </div>
  );
}
