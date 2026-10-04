import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../../lib/fetcher";
import { isSubmitKey } from "../../lib/isSubmitKey";
import { MAX_SESSION_TITLE_LENGTH } from "../../../shared/schemas/chat";

interface SessionTitleProps {
  /** What the session is called now. */
  title: string;
  /** Names the session; absent for a new chat the server does not have yet. */
  onRename?: (title: string) => ResultAsync<void, ApiError>;
}

/**
 * The name of the chat about the book that is open, and the way to change it.
 *
 * A line of its own under the header rather than in it: the header is already
 * the way back and the scope chip, which a narrow sheet has to keep on one row.
 * A failed rename is said here, with the name still in the box, for the reason
 * the highlight editor keeps its own: the panel's other notices are about the
 * conversation, not about what it is called.
 */
export function SessionTitle({ title, onRename }: SessionTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!onRename || draft === null) return;
    const name = draft.trim();
    if (name === "") return;
    setSaving(true);
    setError(null);
    const renamed = await onRename(name);
    setSaving(false);
    if (renamed.isErr()) {
      setError(`名前を変更できませんでした: ${renamed.error.message}`);
      return;
    }
    setDraft(null);
  };

  if (draft === null) {
    return (
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 px-4 py-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{title}</h2>
        {onRename && (
          <button
            type="button"
            aria-label="チャットの名前を変更"
            onClick={() => setDraft(title)}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M4 16l1-4 8-8 3 3-8 8-4 1z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-gray-100 px-4 py-1">
      <div className="flex items-center gap-2">
        <input
          aria-label="チャットの名前"
          value={draft}
          maxLength={MAX_SESSION_TITLE_LENGTH}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e.nativeEvent as unknown as KeyboardEvent)) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              setDraft(null);
            }
          }}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={saving || draft.trim() === ""}
          onClick={() => void save()}
          className="shrink-0 cursor-pointer rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:cursor-default disabled:opacity-50"
        >
          名前を保存
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            setError(null);
          }}
          className="shrink-0 cursor-pointer rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
        >
          やめる
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
