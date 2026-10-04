import { Hono, type Context } from "hono";
import type { ErrorCode } from "../../shared/schemas/error";
import {
  setDropboxTitlesRequestSchema,
  setHiddenRequestSchema,
  type DropboxTitles,
  type HiddenBooks,
} from "../../shared/schemas/shelf";
import { listHiddenKeys, setHidden } from "../services/hiddenBooksService";
import { listDropboxTitles, setDropboxTitles } from "../services/bookTitlesService";
import { validate } from "./validation";

type Env = { Bindings: { DB: D1Database } };

function storageFailureResponse(c: Context, cause: unknown) {
  console.error("Storage failure:", cause);
  return c.json(
    { error: { code: "INTERNAL_ERROR" satisfies ErrorCode, message: "Unexpected server error" } },
    500,
  );
}

export const shelfRoute = new Hono<Env>()
  .get("/shelf/hidden", async (c) => {
    const keys = await listHiddenKeys(c.env.DB);
    if (keys.isErr()) return storageFailureResponse(c, keys.error.cause);
    return c.json({ keys: keys.value } satisfies HiddenBooks);
  })
  // Answers with the whole list afterwards, so the shelf takes it as it is
  // rather than working out what the write did to its own copy.
  .put("/shelf/hidden", validate("json", setHiddenRequestSchema), async (c) => {
    const { keys, hidden } = c.req.valid("json");
    const written = await setHidden(c.env.DB, keys, hidden);
    if (written.isErr()) return storageFailureResponse(c, written.error.cause);

    const all = await listHiddenKeys(c.env.DB);
    if (all.isErr()) return storageFailureResponse(c, all.error.cause);
    return c.json({ keys: all.value } satisfies HiddenBooks);
  })
  .get("/shelf/titles", async (c) => {
    const titles = await listDropboxTitles(c.env.DB);
    if (titles.isErr()) return storageFailureResponse(c, titles.error.cause);
    return c.json({ titles: titles.value } satisfies DropboxTitles);
  })
  // The titles of Dropbox files that are not books yet; a book's own is
  // `PATCH /api/pdf/:pdfId`. Answers with every such title afterwards, the way
  // hiding does.
  .put("/shelf/titles", validate("json", setDropboxTitlesRequestSchema), async (c) => {
    const { keys, title } = c.req.valid("json");
    const written = await setDropboxTitles(c.env.DB, keys, title);
    if (written.isErr()) return storageFailureResponse(c, written.error.cause);

    const all = await listDropboxTitles(c.env.DB);
    if (all.isErr()) return storageFailureResponse(c, all.error.cause);
    return c.json({ titles: all.value } satisfies DropboxTitles);
  });
