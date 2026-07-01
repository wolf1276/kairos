import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(
  __dirname,
  "..",
  "node_modules",
  "tw-animate-css",
  "package.json"
);

try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const original = JSON.stringify(pkg.exports, null, 2);

  if (pkg.exports?.["."]?.style && !pkg.exports["."]?.default) {
    pkg.exports["."].default = pkg.exports["."].style;
    pkg.exports["./prefix"].default = pkg.exports["./prefix"].style;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(
      "✓ Patched tw-animate-css: added `default` export condition"
    );
  } else {
    console.log("✓ tw-animate-css already has `default` export condition");
  }
} catch (e) {
  if (e.code === "ENOENT") {
    console.log("ℹ tw-animate-css not installed, skipping patch");
  } else {
    console.error("✗ Failed to patch tw-animate-css:", e.message);
  }
}
