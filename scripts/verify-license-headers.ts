// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const currentYear = String(new Date().getUTCFullYear());
const copyright = `Copyright (C) ${currentYear} AlbiDR`;
const spdx = "SPDX-License-Identifier: GPL-3.0-only";
const fix = process.argv.includes("--fix");
const ignoredDirectories = new Set([".git", "coverage", "dist", "dist-cli", "node_modules"]);
const licenseNoticeExemptFiles = new Set([
  "LICENSE",
]);
const strictJsonFiles = new Set(["package.json", "package-lock.json", ".github/allowed-contributors.json"]);
const requiredFiles = [
  ".editorconfig",
  ".gitattributes",
  ".github/CODEOWNERS",
  ".github/CONTRIBUTING.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/pull_request_template.md",
  ".github/SECURITY.md",
  ".github/workflows/repository-policy.yml",
  "config/eslint.config.ts",
  "config/tsconfig.cli.json",
  "config/tsconfig.json",
  "config/vite.config.ts",
  "docs/architecture/cleanstack.md",
  "docs/assets/readme/mark-dark.svg",
  "docs/assets/readme/mark.svg",
  "LICENSE",
  "README.md",
  "src/interfaces/web/index.html",
];

interface CommentStyle {
  readonly prefix: string;
  readonly suffix: string;
}

const commentStyles = new Map<string, CommentStyle>([
  [".css", { prefix: "/* ", suffix: " */" }],
  [".env", { prefix: "# ", suffix: "" }],
  [".example", { prefix: "# ", suffix: "" }],
  [".gitignore", { prefix: "# ", suffix: "" }],
  [".html", { prefix: "<!-- ", suffix: " -->" }],
  [".js", { prefix: "// ", suffix: "" }],
  [".json", { prefix: "// ", suffix: "" }],
  [".md", { prefix: "<!-- ", suffix: " -->" }],
  [".mjs", { prefix: "// ", suffix: "" }],
  [".svg", { prefix: "<!-- ", suffix: " -->" }],
  [".ts", { prefix: "// ", suffix: "" }],
  [".yml", { prefix: "# ", suffix: "" }],
  [".yaml", { prefix: "# ", suffix: "" }],
]);

const violations = [];
for (const requiredFile of requiredFiles) {
  try {
    await access(path.join(repositoryRoot, requiredFile));
  } catch {
    violations.push(`${requiredFile}: required repository-governance file is missing.`);
  }
}
const files = await collectFiles(repositoryRoot);

for (const absolutePath of files) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (licenseNoticeExemptFiles.has(relativePath)) continue;
  if (strictJsonFiles.has(relativePath)) {
    await verifyJsonMetadata(absolutePath, relativePath);
    continue;
  }

  const style = getCommentStyle(relativePath);
  if (!style) {
    violations.push(`${relativePath}: no license policy is defined for this file type.`);
    continue;
  }
  const expected = `${style.prefix}${spdx}${style.suffix}\n${style.prefix}${copyright}${style.suffix}`;
  const source = await readFile(absolutePath, "utf8");
  if (source.startsWith(`${expected}\n`)) continue;

  if (fix) {
    const normalized = removeExistingHeader(source);
    await writeFile(absolutePath, `${expected}\n\n${normalized}`, "utf8");
  } else {
    violations.push(`${relativePath}: expected the current ${currentYear} license header at byte zero.`);
  }
}

if (violations.length > 0) {
  process.stderr.write(`License policy failed:\n${violations.map((entry) => `- ${entry}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${fix ? "Updated" : "Verified"} GPL-3.0-only licensing for ${String(files.length)} repository files (${currentYear}).\n`,
  );
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectFiles(absolutePath)));
    else if (entry.isFile()) collected.push(absolutePath);
  }
  return collected.sort();
}

function getCommentStyle(relativePath: string): CommentStyle | undefined {
  if (
    relativePath === ".editorconfig" ||
    relativePath === ".gitattributes" ||
    relativePath === ".gitignore" ||
    path.basename(relativePath) === "CODEOWNERS"
  ) {
    return { prefix: "# ", suffix: "" };
  }
  return commentStyles.get(path.extname(relativePath));
}

function removeExistingHeader(source: string): string {
  const lines = source.split("\n");
  const filtered = lines.filter(
    (line, index) =>
      index > 3 ||
      (!line.includes("SPDX-License-Identifier:") && !line.includes("Copyright (C)")),
  );
  while (filtered[0] === "") filtered.shift();
  return filtered.join("\n");
}

async function verifyJsonMetadata(absolutePath: string, relativePath: string): Promise<void> {
  const source = await readFile(absolutePath, "utf8");
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    violations.push(`${relativePath}: invalid JSON.`);
    return;
  }

  if (!isRecord(document)) {
    violations.push(`${relativePath}: expected a JSON object.`);
    return;
  }
  const packages = isRecord(document.packages) ? document.packages : undefined;
  const rootPackage = packages && isRecord(packages[""]) ? packages[""] : undefined;
  const metadata = relativePath === "package-lock.json" ? rootPackage : document;
  if (metadata?.license === "GPL-3.0-only" && metadata?.copyright === copyright) return;

  if (!fix) {
    violations.push(`${relativePath}: expected structured GPL-3.0-only and ${currentYear} copyright metadata.`);
    return;
  }
  if (!metadata || typeof metadata !== "object") {
    violations.push(`${relativePath}: cannot locate its metadata object.`);
    return;
  }
  metadata.license = "GPL-3.0-only";
  metadata.copyright = copyright;
  await writeFile(absolutePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
