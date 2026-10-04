import { Hono, type Context } from "hono";
import type { ErrorCode } from "../../shared/schemas/error";
import {
  createCollectionRequestSchema,
  renameCollectionRequestSchema,
  setCollectionItemsRequestSchema,
  setDropboxTitlesRequestSchema,
  setHiddenRequestSchema,
  type Collections,
  type DropboxTitles,
  type HiddenBooks,
} from "../../shared/schemas/shelf";
import {
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
  setCollectionItems,
} from "../services/collectionsService";
import { systemIdClock } from "../services/pdfService";
import type { ServiceError } from "../services/serviceError";
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

/** A collection that is not there is 404; a store that refused is 500. */
function collectionFailureResponse(c: Context, failure: ServiceError) {
  if (failure.type === "STORAGE") return storageFailureResponse(c, failure.cause);
  return c.json(
    {
      error: {
        code: "COLLECTION_NOT_FOUND" satisfies ErrorCode,
        message: "Collection not found",
      },
    },
    404,
  );
}

/**
 * Every collection as it stands. Each write answers with this, the way hiding
 * does, so the shelf takes the list as it is rather than working out what the
 * write did to its own copy.
 */
async function collectionsResponse(c: Context<Env>) {
  const all = await listCollections(c.env.DB);
  if (all.isErr()) return storageFailureResponse(c, all.error.cause);
  return c.json({ collections: all.value } satisfies Collections);
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
  })
  .get("/shelf/collections", (c) => collectionsResponse(c))
  .post("/shelf/collections", validate("json", createCollectionRequestSchema), async (c) => {
    const { name, keys } = c.req.valid("json");
    const created = await createCollection(c.env.DB, name, keys ?? [], systemIdClock);
    if (created.isErr()) return storageFailureResponse(c, created.error.cause);
    return collectionsResponse(c);
  })
  // Deleting a collection leaves the books in it on the shelf.
  .delete("/shelf/collections/:collectionId", async (c) => {
    const deleted = await deleteCollection(c.env.DB, c.req.param("collectionId"));
    if (deleted.isErr()) return collectionFailureResponse(c, deleted.error);
    return collectionsResponse(c);
  })
  .patch(
    "/shelf/collections/:collectionId",
    validate("json", renameCollectionRequestSchema),
    async (c) => {
      const renamed = await renameCollection(
        c.env.DB,
        c.req.param("collectionId"),
        c.req.valid("json").name,
      );
      if (renamed.isErr()) return collectionFailureResponse(c, renamed.error);
      return collectionsResponse(c);
    },
  )
  .put(
    "/shelf/collections/:collectionId/items",
    validate("json", setCollectionItemsRequestSchema),
    async (c) => {
      const { keys, member } = c.req.valid("json");
      const written = await setCollectionItems(c.env.DB, c.req.param("collectionId"), keys, member);
      if (written.isErr()) return collectionFailureResponse(c, written.error);
      return collectionsResponse(c);
    },
  );
