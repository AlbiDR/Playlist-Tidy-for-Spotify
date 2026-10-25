// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 4174;
const failures: string[] = [];
const server = await preview({
  configFile: fileURLToPath(new URL("../config/vite.config.ts", import.meta.url)),
  preview: { host, port, strictPort: true },
});
const browserTypes = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
] as const;

try {
  for (const [browserName, browserType] of browserTypes) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 1440, height: 1024 }]) {
        const context = await browser.newContext({
          colorScheme: "dark",
          reducedMotion: "reduce",
          viewport,
        });
        const page = await context.newPage();
        page.on("console", (message) => {
          if (message.type() === "error") failures.push(`${browserName} console error: ${message.text()}`);
        });
        page.on("pageerror", (error) => failures.push(`${browserName} page error: ${error.message}`));
        await page.goto(`http://${host}:${String(port)}/`, { waitUntil: "networkidle" });

    const facts = await page.evaluate(() => {
      const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(({ id }) => id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const externalLinksWithoutProtection = [...document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')]
        .filter(({ relList }) => !relList.contains("noopener") || !relList.contains("noreferrer"))
        .length;
      const unnamedControls = [...document.querySelectorAll<HTMLElement>("button, input, select, textarea")]
        .filter((element) => {
          const labelledBy = element.getAttribute("aria-labelledby");
          return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().length === 0 && labelledBy === null;
        })
        .length;
      return {
        duplicateIds,
        externalLinksWithoutProtection,
        headingOneCount: document.querySelectorAll("h1").length,
        mainCount: document.querySelectorAll("main").length,
        unnamedControls,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pointerLightCount: document.querySelectorAll(".pointer-light").length,
      };
    });

        const contextName = `${browserName} at ${String(viewport.width)}px`;
        if (facts.mainCount !== 1) failures.push(`${contextName} has ${String(facts.mainCount)} main landmarks.`);
        if (facts.headingOneCount !== 1) failures.push(`${contextName} has ${String(facts.headingOneCount)} h1 elements.`);
        if (facts.duplicateIds.length > 0) failures.push(`${contextName} has duplicate IDs: ${facts.duplicateIds.join(", ")}.`);
        if (facts.externalLinksWithoutProtection > 0) failures.push(`${contextName} has an unprotected external new-tab link.`);
        if (facts.unnamedControls > 0) failures.push(`${contextName} has ${String(facts.unnamedControls)} controls without accessible names.`);
        if (facts.horizontalOverflow > 1) failures.push(`${contextName} overflows by ${String(facts.horizontalOverflow)}px.`);
        if (facts.pointerLightCount !== 0) failures.push(`${contextName} initialized motion despite the reduced-motion preference.`);

        const skipLink = page.locator(".skip-link");
        if (await skipLink.count() === 0) {
          failures.push(`${contextName} did not render the application skip link.`);
          await context.close();
          continue;
        }
        const skipLinkIsFirst = await page.evaluate(() =>
          document.querySelector("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")?.classList.contains("skip-link") === true,
        );
        if (!skipLinkIsFirst) failures.push(`${contextName} does not place the skip link first in focus order.`);
        if (browserName === "WebKit") await skipLink.focus();
        else await page.keyboard.press("Tab");
        if (!(await skipLink.evaluate((element) => element === document.activeElement))) {
          failures.push(`${contextName} does not expose the skip link as the first focus target.`);
        }
        await page.keyboard.press("Enter");
        const focusedId = await page.evaluate(() => document.activeElement?.id ?? "");
        if (focusedId !== "main-content") failures.push(`${contextName} did not move skip-link focus to main.`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

if (failures.length > 0) {
  process.stderr.write(`Browser audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Chromium, Firefox, and WebKit accessibility and responsive audits passed.\n");
}
