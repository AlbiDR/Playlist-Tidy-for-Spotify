// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

interface ContributorPolicy {
  readonly humans: readonly {
    readonly name: string;
    readonly emails: readonly string[];
  }[];
}

const policy = JSON.parse(
  readFileSync(new URL("../.github/allowed-contributors.json", import.meta.url), "utf8"),
) as ContributorPolicy;

if (!Array.isArray(policy.humans) || policy.humans.length === 0) {
  throw new Error("Contributor policy must contain at least one explicitly allowed human.");
}

const allowedIdentities = new Set(
  policy.humans.flatMap(({ name, emails }) => {
    if (typeof name !== "string" || !Array.isArray(emails) || emails.length === 0) {
      throw new Error("Every allowed human requires a name and at least one email address.");
    }
    return emails.map((email) => `${name}\u0000${String(email).toLowerCase()}`);
  }),
);

const forbiddenAutomationIdentity =
  /(?:\b(?:ai|bot)\b|claude|codex|copilot|chatgpt|openai|anthropic|gemini|dependabot|github-actions|cursor)/iu;

const log = execFileSync(
  "git",
  [
    "log",
    "--all",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00%x1e",
  ],
  { encoding: "utf8" },
);

const violations: string[] = [];
for (const record of log.split("\u001e")) {
  const normalized = record.replace(/^\s+|\s+$/gu, "");
  if (normalized.length === 0) continue;
  const [sha, authorName, authorEmail, committerName, committerEmail, ...messageParts] =
    normalized.split("\u0000");
  const message = messageParts.join("\u0000");
  if (!sha || !authorName || !authorEmail || !committerName || !committerEmail) {
    violations.push("Unable to parse a commit attribution record.");
    continue;
  }

  if (!allowedIdentities.has(`${authorName}\u0000${authorEmail.toLowerCase()}`)) {
    violations.push(`${sha}: author ${authorName} <${authorEmail}> is not an approved human.`);
  }
  if (forbiddenAutomationIdentity.test(`${authorName} ${authorEmail}`)) {
    violations.push(`${sha}: author metadata identifies automation or an AI system.`);
  }
  if (forbiddenAutomationIdentity.test(`${committerName} ${committerEmail}`)) {
    violations.push(`${sha}: committer metadata identifies automation or an AI system.`);
  }

  for (const match of message.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gimu)) {
    const [, coAuthorName, coAuthorEmail] = match;
    if (!coAuthorName || !coAuthorEmail) continue;
    if (!allowedIdentities.has(`${coAuthorName}\u0000${coAuthorEmail.toLowerCase()}`)) {
      violations.push(
        `${sha}: co-author ${coAuthorName} <${coAuthorEmail}> is not an approved human.`,
      );
    }
    if (forbiddenAutomationIdentity.test(`${coAuthorName} ${coAuthorEmail}`)) {
      violations.push(`${sha}: co-author metadata identifies automation or an AI system.`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Contributor attribution policy failed:\n${violations.map((entry) => `- ${entry}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Contributor attribution policy passed: all attributed contributors are approved humans.\n");
}
