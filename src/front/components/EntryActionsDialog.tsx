interface EntryAction {
  /** What the button says. */
  label: string;
  /**
   * Its accessible name, which carries the entry's title — the shelf has a
   * button like it on every entry, and the tests and E2E reach for it by name.
   */
  name: string;
  onSelect: () => void;
}

interface EntryActionsDialogProps {
  /** The entry's title, which heads the sheet. */
  title: string;
  actions: EntryAction[];
  onClose: () => void;
}

/**
 * The less frequent things done to a shelf entry — renaming it, filing it in
 * collections, putting it away — gathered behind its 「…」.
 *
 * A sheet rather than a menu hung off the button: on a phone the card is half
 * the screen wide and a menu would run off it, and a modal closes the way the
 * shelf's other dialogs do (Escape, a click outside) without listening on the
 * document.
 */
export function EntryActionsDialog({ title, actions, onClose }: EntryActionsDialogProps) {
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} の操作`}
        className="w-full max-w-sm rounded-lg bg-white p-3 shadow-xl"
      >
        <p className="truncate px-2 pb-2 text-sm font-medium text-gray-800">{title}</p>
        <ul className="flex flex-col">
          {actions.map((action, i) => (
            <li key={action.name}>
              <button
                type="button"
                aria-label={action.name}
                // The first is where the keyboard starts, so Escape and Tab work
                // without reaching for the pointer.
                autoFocus={i === 0}
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
                className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm text-gray-800 cursor-pointer hover:bg-gray-100"
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-end border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 cursor-pointer hover:bg-gray-100"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
