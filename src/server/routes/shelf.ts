import { Hono, type Context } from "hono";
import type { ErrorCode } from "../../shared/schemas/error";
import { setHiddenRequestSchema, type HiddenBooks } from "../../shared/schemas/shelf";
import { listHiddenKeys, setHidden } from "../services/hiddenBooksService";
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
  });
