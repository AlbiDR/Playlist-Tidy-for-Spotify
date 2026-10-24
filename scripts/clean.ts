// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputs = [
  new URL("../dist/", import.meta.url),
  new URL("../dist-cli/", import.meta.url),
];

await Promise.all(outputs.map(async (output) => rm(fileURLToPath(output), { force: true, recursive: true })));
