// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const forbiddenCharacters = new Map([
  [String.fromCodePoint(0x2013), "en dash"],
  [String.fromCodePoint(0x2014), "em dash"],
]);

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\u0000")
  .filter((path) => path.length > 0);
const violations: string[] = [];

for (const path of trackedFiles) {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    continue;
  }

  for (const [character, name] of forbiddenCharacters) {
    for (const match of contents.matchAll(new RegExp(character, "gu"))) {
      const offset = match.index;
      const line = contents.slice(0, offset).split("\n").length;
      violations.push(`${path}:${String(line)} contains an ${name}.`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Typography policy failed:\n${violations.map((entry) => `- ${entry}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Typography policy passed: tracked files contain no en or em dashes.\n");
}
