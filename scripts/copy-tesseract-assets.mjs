import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Tesseract (the OCR that reads PDFs without a text layer) runs in a Web Worker
// that loads three things at runtime: its worker script, the WebAssembly core,
// and the trained model of each language. By default it pulls all three from
// jsdelivr; they are served from the site instead, out of node_modules, so a
// book is read with the very versions the app was built against and nothing
// depends on a third party being up. See CLAUDE.md「テキストの無い PDF（OCR）」.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "public", "tesseract");
const fromRoot = createRequire(path.join(root, "package.json"));
// The real path rather than node_modules' link to it: pnpm keeps a package's
// own dependencies next to where it really is, not beside the link.
const tesseractDir = await fs.realpath(path.join(root, "node_modules", "tesseract.js"));
const fromTesseract = createRequire(path.join(tesseractDir, "package.json"));
const coreDir = path.dirname(fromTesseract.resolve("tesseract.js-core"));

await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(path.join(dest, "core"), { recursive: true });
await fs.mkdir(path.join(dest, "lang"), { recursive: true });

await fs.copyFile(
  path.join(tesseractDir, "dist", "worker.min.js"),
  path.join(dest, "worker.min.js"),
);

// Only the LSTM builds: the app asks for the LSTM engine alone, which is what
// the best_int models carry. The worker picks one of the three by what the
// browser's WebAssembly supports, and the .wasm.js files carry the binary
// inside them, so nothing else is fetched.
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
  const file = `tesseract-core-${variant}.wasm.js`;
  await fs.copyFile(path.join(coreDir, file), path.join(dest, "core", file));
}

// best_int: the LSTM model with integer weights — 2MB for Japanese, 3MB for
// English, gzipped. The float models beside them are 16MB and 11MB and read no
// better for printed books.
for (const lang of ["jpn", "eng"]) {
  const dataDir = path.dirname(fromRoot.resolve(`@tesseract.js-data/${lang}/package.json`));
  const file = `${lang}.traineddata.gz`;
  await fs.copyFile(path.join(dataDir, "4.0.0_best_int", file), path.join(dest, "lang", file));
}

console.log(`Copied Tesseract worker, core and jpn/eng models to ${path.relative(root, dest)}`);
