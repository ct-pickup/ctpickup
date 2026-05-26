import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib", "pickup");
const DEST = path.join(ROOT, "mobile", "lib", "pickup");

// By default, only copy files that don't already exist in mobile/lib/pickup.
// Use `--overwrite` if you want to force-sync.
const overwrite = process.argv.includes("--overwrite");

const ALLOWED_EXT = new Set([".ts", ".tsx"]);

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (ALLOWED_EXT.has(path.extname(p))) {
      out.push(p);
    }
  }
  return out;
}

async function fileMtimeMs(p) {
  const st = await fs.stat(p);
  return st.mtimeMs;
}

async function main() {
  await ensureDir(DEST);
  const files = await walk(SRC);
  let copied = 0;
  let skippedExisting = 0;
  let errors = 0;

  for (const srcFile of files) {
    const rel = path.relative(SRC, srcFile);
    const destFile = path.join(DEST, rel);
    await ensureDir(path.dirname(destFile));

    try {
      const destExists = await fs
        .access(destFile)
        .then(() => true)
        .catch(() => false);

      if (destExists && !overwrite) {
        skippedExisting++;
        continue;
      }

      // If overwriting, only copy when mtime differs to avoid unnecessary churn.
      if (destExists && overwrite) {
        const [s, d] = await Promise.all([fileMtimeMs(srcFile), fileMtimeMs(destFile)]);
        if (d >= s) {
          skippedExisting++;
          continue;
        }
      }

      await fs.copyFile(srcFile, destFile);
      copied++;
    } catch (e) {
      errors++;
      console.error("[sync-mobile-lib-pickup] copy failed:", { srcFile, destFile, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(
    `[sync-mobile-lib-pickup] done. copied=${copied}, skippedExisting=${skippedExisting}, errors=${errors}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

