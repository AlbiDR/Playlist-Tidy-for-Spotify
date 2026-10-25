// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = fileURLToPath(new URL("../dist/web/", import.meta.url));
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);
const forbiddenPattern = new RegExp(
  `[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`,
  "gu",
);
let replacementCount = 0;

function sanitizeDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sanitizeDirectory(path);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(extname(entry.name))) continue;

    const contents = readFileSync(path, "utf8");
    const sanitized = contents.replace(forbiddenPattern, () => {
      replacementCount += 1;
      return "-";
    });
    if (sanitized !== contents) writeFileSync(path, sanitized, "utf8");
  }
}

if (!existsSync(outputRoot)) throw new Error("The web build output is missing.");
sanitizeDirectory(outputRoot);

process.stdout.write(
  replacementCount === 0
    ? "Production typography safeguard passed without replacements.\n"
    : `Production typography safeguard replaced ${String(replacementCount)} forbidden dash characters.\n`,
);
