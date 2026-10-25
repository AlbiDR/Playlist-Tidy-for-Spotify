// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDirectory = fileURLToPath(new URL("../src/interfaces/web/public/", import.meta.url));
const iconSource = await readFile(new URL("../src/interfaces/web/public/app-icon.svg", import.meta.url));
const socialCardSource = await readFile(new URL("../src/interfaces/web/assets/social-card.svg", import.meta.url));

await Promise.all([
  renderSquareIcon(192, "app-icon-192.png"),
  renderSquareIcon(512, "app-icon-512.png"),
  renderSquareIcon(180, "apple-touch-icon.png"),
  sharp(socialCardSource, { density: 144 })
    .resize(1200, 630)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(`${publicDirectory}/social-card.png`),
]);

process.stdout.write("Generated deterministic web icons and social preview artwork.\n");

async function renderSquareIcon(size: number, name: string): Promise<void> {
  await sharp(iconSource, { density: 192 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(`${publicDirectory}/${name}`);
}
