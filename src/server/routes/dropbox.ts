import { Hono, type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { isNotNull } from "drizzle-orm";
import { ResultAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { pdfs } from "../db/schema";
import {
  DropboxClient,
  dropboxCredentials,
  isInsideFolder,
  type DropboxEnv,
  type DropboxError,
} from "../services/dropboxService";
import { storageFailure, type StorageError } from "../services/serviceError";
import { getDropboxFolder, saveDropboxFolder } from "../services/settingsService";
import { BOOK_CONTENT_TYPES } from "../services/pdfService";
import {
  normalizeDropboxFolder,
  saveDropboxFolderRequestSchema,
  type DropboxFolderListing,
  type DropboxSettings,
} from "../../shared/schemas/dropbox";
import type { ErrorCode } from "../../shared/schemas/error";
import { validate } from "./validation";

type Env = {
  Bindings: DropboxEnv & {
    DB: D1Database;
  };
};

/**
 * The reply a Dropbox call that went wrong turns into. A 502 rather than a 500:
 * this server is fine, the one behind it is not, and trying again later is all
 * anyone can do. The cause stays in the log.
 */
export function dropboxFailureResponse(c: Context, cause: unknown) {
  console.error("Dropbox failure:", cause);
  return c.json(
    {
      error: {
        code: "DROPBOX_ERROR" satisfies ErrorCode,
        message: "Dropbox did not answer as expected",
      },
    },
    502,
  );
}

function storageFailureResponse(c: Context, cause: unknown) {
  console.error("Storage failure:", cause);
  return c.json(
    { error: { code: "INTERNAL_ERROR" satisfies ErrorCode, message: "Unexpected server error" } },
    500,
  );
}

const UNAVAILABLE = {
  code: "DROPBOX_UNAVAILABLE" satisfies ErrorCode,
  message: "Dropbox is not configured on this server",
} as const;

const FILE_NOT_FOUND = {
  code: "DROPBOX_FILE_NOT_FOUND" satisfies ErrorCode,
  message: "No such file in the Dropbox folder",
} as const;

/** `?id=` of the file to fetch. Dropbox ids are `id:` followed by the id proper. */
const fileQuerySchema = z.object({ id: z.string().startsWith("id:").max(200) });

/** The ids of the Dropbox files that are already books, to keep them off the "not yet" list. */
async function importedDropboxIds(db: D1Database): Promise<Set<string>> {
  const rows = await drizzle(db)
    .select({ dropboxId: pdfs.dropboxId })
    .from(pdfs)
    .where(isNotNull(pdfs.dropboxId))
    .all();
  return new Set(rows.map((row) => row.dropboxId as string));
}

/** A client for this deploy's Dropbox, or null when it holds no credentials. */
export function dropboxClientFor(env: DropboxEnv): DropboxClient | null {
  const credentials = dropboxCredentials(env);
  return credentials ? new DropboxClient(credentials) : null;
}

/**
 * The deploy's Dropbox and the folder chosen in it, or null when either is
 * missing — then books live in R2 alone, the way they did before Dropbox.
 */
export function dropboxFolderOf(
  env: DropboxEnv & { DB: D1Database },
): ResultAsync<{ client: DropboxClient; folder: string } | null, StorageError> {
  const client = dropboxClientFor(env);
  if (!client) return okAsync(null);
  return getDropboxFolder(env.DB).map((folder) => (folder === null ? null : { client, folder }));
}

export const dropboxRoute = new Hono<Env>()
  .get("/dropbox/settings", async (c) => {
    const folder = await getDropboxFolder(c.env.DB);
    if (folder.isErr()) return storageFailureResponse(c, folder.error.cause);

    const answer: DropboxSettings = {
      available: dropboxCredentials(c.env) !== null,
      folder: folder.value,
    };
    return c.json(answer);
  })
  // Checked against Dropbox before it is kept: a folder that does not exist
  // would otherwise turn every later shelf into an error the reader has to
  // trace back to a typo made here.
  .put("/dropbox/settings", validate("json", saveDropboxFolderRequestSchema), async (c) => {
    const client = dropboxClientFor(c.env);
    if (!client) return c.json({ error: UNAVAILABLE }, 400);

    const folder = normalizeDropboxFolder(c.req.valid("json").folder);
    if (folder === null) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR" satisfies ErrorCode,
            message: "Invalid folder path",
          },
        },
        400,
      );
    }

    const exists = await client.folderExists(folder);
    if (exists.isErr()) return dropboxFailureResponse(c, exists.error);
    if (!exists.value) {
      return c.json(
        {
          error: {
            code: "DROPBOX_FOLDER_NOT_FOUND" satisfies ErrorCode,
            message: `No folder at ${folder} in Dropbox`,
          },
        },
        400,
      );
    }

    const saved = await saveDropboxFolder(c.env.DB, folder);
    if (saved.isErr()) return storageFailureResponse(c, saved.error.cause);

    const answer: DropboxSettings = { available: true, folder };
    return c.json(answer);
  })
  // The PDFs in the folder that are not books yet. Listed apart from the
  // shelf itself so the books already on it never wait for Dropbox.
  .get("/dropbox/files", async (c) => {
    const client = dropboxClientFor(c.env);
    if (!client) return c.json({ state: "unavailable" } satisfies DropboxFolderListing);

    const folder = await getDropboxFolder(c.env.DB);
    if (folder.isErr()) return storageFailureResponse(c, folder.error.cause);
    if (folder.value === null) {
      return c.json({ state: "no-folder" } satisfies DropboxFolderListing);
    }

    const listed = await client.listPdfs(folder.value);
    if (listed.isErr()) {
      return listed.error.type === "NOT_FOUND"
        ? c.json(
            {
              error: {
                code: "DROPBOX_FOLDER_NOT_FOUND" satisfies ErrorCode,
                message: `No folder at ${folder.value} in Dropbox`,
              },
            },
            404,
          )
        : dropboxFailureResponse(c, listed.error.cause);
    }

    const imported = await ResultAsync.fromPromise(importedDropboxIds(c.env.DB), storageFailure);
    if (imported.isErr()) return storageFailureResponse(c, imported.error.cause);

    const prefixLength = folder.value === "/" ? 0 : folder.value.length;
    const answer: DropboxFolderListing = {
      state: "ready",
      folder: folder.value,
      files: listed.value
        .filter((entry) => !imported.value.has(entry.id))
        .map((entry) => ({
          dropboxId: entry.id,
          name: entry.name,
          path: entry.pathDisplay.slice(prefixLength),
          size: entry.size,
        }))
        .sort((a, b) => a.path.localeCompare(b.path, "ja")),
    };
    return c.json(answer);
  })
  // The bytes of a file in the folder, for the reader to extract before the
  // book is stored. Passed through as Dropbox sends them, so a large book
  // reaches the browser as it arrives rather than after the Worker holds
  // all of it.
  .get("/dropbox/file", validate("query", fileQuerySchema), async (c) => {
    const client = dropboxClientFor(c.env);
    if (!client) return c.json({ error: UNAVAILABLE }, 400);

    const folder = await getDropboxFolder(c.env.DB);
    if (folder.isErr()) return storageFailureResponse(c, folder.error.cause);
    if (folder.value === null) return c.json({ error: FILE_NOT_FOUND }, 404);

    const downloaded = await client.download(c.req.valid("query").id);
    if (downloaded.isErr()) return downloadFailureResponse(c, downloaded.error);

    const { entry, body } = downloaded.value;
    // The endpoint is for the chosen folder's books, not a way into the
    // rest of the Dropbox by id.
    if (!isInsideFolder(entry.pathLower, folder.value)) {
      await body.cancel();
      return c.json({ error: FILE_NOT_FOUND }, 404);
    }

    return new Response(body, {
      headers: {
        // Named by the extension the listing chose the file by; the reader
        // reads the bytes for itself, and the server does again on storing.
        "Content-Type": /\.epub$/i.test(entry.name)
          ? BOOK_CONTENT_TYPES.epub
          : BOOK_CONTENT_TYPES.pdf,
        "Cache-Control": "private, no-store",
      },
    });
  });

function downloadFailureResponse(c: Context, failure: DropboxError) {
  return failure.type === "NOT_FOUND"
    ? c.json({ error: FILE_NOT_FOUND }, 404)
    : dropboxFailureResponse(c, failure.cause);
}
