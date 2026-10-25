// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox, webkit } from "playwright";
import type { Page } from "playwright";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 4174;
const origin = `http://${host}:${String(port)}`;
const failures: string[] = [];
const routes = [
  {
    path: "/",
    title: "Playlist Tidy for Spotify",
    reciprocalLink: "./privacy.html",
    requiredText: "Synthetic sample data",
  },
  {
    path: "/privacy.html",
    title: "Privacy & safe use | Playlist Tidy",
    reciprocalLink: "./",
    requiredText: "The public website does not provide a shared Spotify application",
  },
  {
    path: "/404.html",
    title: "Page not found | Playlist Tidy",
    reciprocalLink: "/PlaylistTidy/",
    requiredText: "That page does not exist",
  },
] as const;
const viewports = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 1440, height: 1024 },
] as const;
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
      for (const viewport of viewports) {
        for (const route of routes) {
          const context = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce", viewport });
          const page = await context.newPage();
          if (route.path === "/404.html") await mapProductionRootToPreview(page);
          const thirdPartyRequests: string[] = [];
          page.on("request", (request) => {
            const requestOrigin = new URL(request.url()).origin;
            if (requestOrigin !== origin) thirdPartyRequests.push(requestOrigin);
          });
          page.on("console", (message) => {
            if (message.type() === "error") failures.push(`${browserName} console error: ${message.text()}`);
          });
          page.on("pageerror", (error) => failures.push(`${browserName} page error: ${error.message}`));
          await page.goto(`${origin}${route.path}`, { waitUntil: "networkidle" });

          const facts = await page.evaluate(() => {
            const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(({ id }) => id);
            const headings = [...document.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6")]
              .map((heading) => Number(heading.tagName.slice(1)));
            const unnamedControls = [...document.querySelectorAll<HTMLElement>("button, input, select, textarea")]
              .filter((element) => {
                const label = element instanceof HTMLInputElement && element.id.length > 0
                  ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
                  : null;
                return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().length === 0
                  && element.getAttribute("aria-labelledby") === null
                  && label === null;
              })
              .length;
            return {
              cookies: document.cookie,
              documentLanguage: document.documentElement.lang,
              duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
              externalResourceHints: [...document.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"], link[rel="dns-prefetch"]')]
                .filter((link) => {
                  try {
                    return new URL(link.href).origin !== window.location.origin;
                  } catch {
                    return true;
                  }
                }).length,
              externalLinksWithoutProtection: [...document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')]
                .filter(({ relList }) => !relList.contains("noopener") || !relList.contains("noreferrer"))
                .length,
              headingOneCount: document.querySelectorAll("h1").length,
              horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              imagesWithoutAlternatives: [...document.querySelectorAll<HTMLImageElement>("img")]
                .filter((image) => !image.hasAttribute("alt")).length,
              imagesWithoutDimensions: [...document.querySelectorAll<HTMLImageElement>("img")]
                .filter((image) => !image.hasAttribute("width") || !image.hasAttribute("height")).length,
              localStorageCount: window.localStorage.length,
              mainCount: document.querySelectorAll("main").length,
              pointerLightCount: document.querySelectorAll(".pointer-light").length,
              sessionStorageCount: window.sessionStorage.length,
              skippedHeadingLevel: headings.some(
                (level, index) => index > 0 && level > (headings[index - 1] ?? level) + 1,
              ),
              title: document.title,
              unnamedControls,
              viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
            };
          });

          const contextName = `${browserName} ${route.path} at ${String(viewport.width)}px`;
          if (facts.mainCount !== 1) failures.push(`${contextName} has ${String(facts.mainCount)} main landmarks.`);
          if (facts.headingOneCount !== 1) failures.push(`${contextName} has ${String(facts.headingOneCount)} h1 elements.`);
          if (facts.documentLanguage !== "en") failures.push(`${contextName} does not declare English as its language.`);
          if (facts.title !== route.title) failures.push(`${contextName} has an unexpected document title.`);
          if (!facts.viewportMeta.includes("width=device-width")) failures.push(`${contextName} is missing a device-width viewport.`);
          if (facts.skippedHeadingLevel) failures.push(`${contextName} skips a heading level.`);
          if (facts.duplicateIds.length > 0) failures.push(`${contextName} has duplicate IDs: ${facts.duplicateIds.join(", ")}.`);
          if (facts.externalLinksWithoutProtection > 0) failures.push(`${contextName} has an unprotected external new-tab link.`);
          if (facts.externalResourceHints > 0) failures.push(`${contextName} primes a third-party connection before user action.`);
          if (facts.unnamedControls > 0) failures.push(`${contextName} has ${String(facts.unnamedControls)} controls without accessible names.`);
          if (facts.imagesWithoutAlternatives > 0) failures.push(`${contextName} has an image without an alt attribute.`);
          if (facts.imagesWithoutDimensions > 0) failures.push(`${contextName} has an image without explicit dimensions.`);
          if (facts.horizontalOverflow > 1) failures.push(`${contextName} overflows by ${String(facts.horizontalOverflow)}px.`);
          if (facts.pointerLightCount !== 0) failures.push(`${contextName} initialized motion despite reduced motion.`);
          if (facts.cookies.length > 0 || facts.localStorageCount > 0 || facts.sessionStorageCount > 0) {
            failures.push(`${contextName} persisted browser data before authorization.`);
          }
          if (thirdPartyRequests.length > 0) {
            failures.push(`${contextName} contacted third parties before user action: ${[...new Set(thirdPartyRequests)].join(", ")}.`);
          }
          if (viewport.width === 1440) await auditAxe(page, contextName);

          const skipLink = page.locator(".skip-link");
          if (await skipLink.count() === 0) {
            failures.push(`${contextName} did not render the skip link.`);
            await context.close();
            continue;
          }
          const skipLinkIsFirst = await page.evaluate(() =>
            document.querySelector("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")?.classList.contains("skip-link") === true,
          );
          if (!skipLinkIsFirst) failures.push(`${contextName} does not place the skip link first in focus order.`);
          if (browserName === "WebKit") await skipLink.focus();
          else await page.keyboard.press("Tab");
          if (!(await skipLink.evaluate((element) => element === document.activeElement))) {
            failures.push(`${contextName} does not expose the skip link as the first focus target.`);
          }
          const focusAppearance = await skipLink.evaluate((element) => {
            const style = getComputedStyle(element);
            return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
          });
          if (focusAppearance.style === "none" || focusAppearance.width < 2) {
            failures.push(`${contextName} does not visibly outline keyboard focus.`);
          }
          await page.keyboard.press("Enter");
          if ((await page.evaluate(() => document.activeElement?.id ?? "")) !== "main-content") {
            failures.push(`${contextName} did not move skip-link focus to main.`);
          }
          if (await page.locator(`a[href="${route.reciprocalLink}"]`).count() === 0) {
            failures.push(`${contextName} is missing reciprocal home/privacy navigation.`);
          }
          if (!(await page.locator("body").innerText()).toLowerCase().includes(route.requiredText.toLowerCase())) {
            failures.push(`${contextName} is missing its Spotify availability disclosure.`);
          }
          await context.close();
        }
      }

      await auditFramedApplication(browser, browserName);

      if (browserName === "Chromium") {
        await auditNoScriptFallback(browser);
        await auditForcedColors(browser);
        await auditTextResize(browser);
        await auditKeyboardNavigation(browser);
        await auditInteractionField(browser);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

async function auditAxe(page: Page, contextName: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  for (const violation of results.violations) {
    const targets = violation.nodes.flatMap((node) => node.target).slice(0, 12).join(", ");
    failures.push(
      `${contextName} fails axe rule ${violation.id}: ${violation.help} (${String(violation.nodes.length)} ${violation.nodes.length === 1 ? "node" : "nodes"}${targets.length > 0 ? `: ${targets}` : ""}).`,
    );
  }
}

async function mapProductionRootToPreview(page: Page): Promise<void> {
  await page.route(`${origin}/PlaylistTidy/**`, async (route) => {
    const target = new URL(route.request().url());
    target.pathname = target.pathname.replace(/^\/PlaylistTidy/u, "");
    await route.continue({ url: target.href });
  });
}

async function auditFramedApplication(
  browser: import("playwright").Browser,
  browserName: string,
): Promise<void> {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 900, height: 700 } });
  try {
    const page = await context.newPage();
    const spotifyRequests: string[] = [];
    const runtimeErrors: string[] = [];
    page.on("request", (request) => {
      if (/^https:\/\/(?:accounts|api)\.spotify\.com\//u.test(request.url())) spotifyRequests.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
    await page.setContent(
      `<iframe title="Untrusted embedding page" src="${origin}/" width="800" height="600"></iframe>`,
    );
    const frame = page.frameLocator("iframe");
    await frame.locator(".frame-refusal").waitFor();
    const facts = await frame.locator("html").evaluate(() => ({
      activeElementId: document.activeElement?.id ?? "",
      connectButtons: document.querySelectorAll("#connection-action").length,
      firstFocusableIsSkipLink: document.querySelector(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )?.classList.contains("skip-link") === true,
      localStorageCount: window.localStorage.length,
      sessionStorageCount: window.sessionStorage.length,
      text: document.body.innerText,
    }));
    const directLink = frame.getByRole("link", { name: "Open Playlist Tidy in a new tab" });
    const contextName = `${browserName} framed application`;
    if (!facts.text.includes("will not connect to Spotify")) {
      failures.push(`${contextName} does not explain why direct access is required.`);
    }
    if (facts.activeElementId === "main-content" || !facts.firstFocusableIsSkipLink) {
      failures.push(`${contextName} does not preserve the skip link as its first intentional focus target.`);
    }
    if (facts.connectButtons !== 0 || spotifyRequests.length > 0) {
      failures.push(`${contextName} initialized Spotify access instead of failing closed.`);
    }
    if (facts.localStorageCount !== 0 || facts.sessionStorageCount !== 0) {
      failures.push(`${contextName} wrote browser storage before refusing the frame.`);
    }
    if (
      await directLink.getAttribute("target") !== "_blank" ||
      (await directLink.getAttribute("rel"))?.split(/\s+/u).includes("noopener") !== true ||
      (await directLink.getAttribute("rel"))?.split(/\s+/u).includes("noreferrer") !== true
    ) {
      failures.push(`${contextName} does not provide a protected direct-open link.`);
    }
    if (runtimeErrors.length > 0) {
      failures.push(`${contextName} emitted runtime errors: ${runtimeErrors.join("; ")}.`);
    }
  } finally {
    await context.close();
  }
}

if (failures.length > 0) {
  process.stderr.write(`Browser audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Chromium, Firefox, and WebKit accessibility, privacy, and responsive audits passed.\n");
}

async function auditNoScriptFallback(browser: import("playwright").Browser): Promise<void> {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const facts = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      message: document.querySelector("noscript")?.textContent?.trim() ?? "",
      mainCount: document.querySelectorAll("main").length,
    }));
    if (facts.mainCount !== 1 || facts.heading.length === 0 || !facts.message.includes("JavaScript is required")) {
      failures.push("Chromium without JavaScript does not provide a meaningful fallback.");
    }
  } finally {
    await context.close();
  }
}

async function auditForcedColors(browser: import("playwright").Browser): Promise<void> {
  const context = await browser.newContext({
    forcedColors: "active",
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const facts = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      progressDisplay: getComputedStyle(document.querySelector(".reading-progress") as HTMLElement).display,
    }));
    if (facts.horizontalOverflow > 1) failures.push("Chromium forced-colors mode overflows horizontally.");
    if (facts.progressDisplay !== "none") failures.push("Chromium forced-colors mode retains decorative progress effects.");
  } finally {
    await context.close();
  }
}

async function auditTextResize(browser: import("playwright").Browser): Promise<void> {
  for (const route of routes) {
    const context = await browser.newContext({
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport: { width: 320, height: 720 },
    });
    try {
      const page = await context.newPage();
      if (route.path === "/404.html") await mapProductionRootToPreview(page);
      await page.goto(`${origin}${route.path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const facts = await page.evaluate(() => {
        const clippedControls = [...document.querySelectorAll<HTMLElement>("a[href], button")]
          .filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const clips = style.overflowX === "hidden" || style.overflowX === "clip"
              || style.overflowY === "hidden" || style.overflowY === "clip";
            return clips && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
          })
          .map((element) => element.textContent?.trim() ?? element.tagName);
        return {
          clippedControls,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                description: `${element.tagName.toLowerCase()}${element.id.length > 0 ? `#${element.id}` : ""}${element.className.length > 0 && typeof element.className === "string" ? `.${element.className.trim().replaceAll(/\s+/gu, ".")}` : ""}`,
                left: Math.round(rect.left),
                right: Math.round(rect.right),
              };
            })
            .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
            .slice(0, 8),
        };
      });
      const contextName = `Chromium ${route.path} at 200% text size`;
      if (facts.horizontalOverflow > 1) {
        const elements = facts.overflowingElements
          .map(({ description, left, right }) => `${description} (${String(left)}..${String(right)})`)
          .join(", ");
        failures.push(`${contextName} overflows horizontally by ${String(facts.horizontalOverflow)}px${elements.length > 0 ? `: ${elements}` : "."}`);
      }
      if (facts.clippedControls.length > 0) {
        failures.push(`${contextName} clips interactive text: ${facts.clippedControls.join(", ")}.`);
      }
    } finally {
      await context.close();
    }
  }
}

async function auditKeyboardNavigation(browser: import("playwright").Browser): Promise<void> {
  for (const route of routes) {
    const context = await browser.newContext({
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      if (route.path === "/404.html") await mapProductionRootToPreview(page);
      await page.goto(`${origin}${route.path}`, { waitUntil: "networkidle" });
      const expectedCount = await page.locator(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ).evaluateAll((elements) => elements.filter((element) => {
        if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) return false;
        const closedDetails = element.closest("details:not([open])");
        if (closedDetails !== null && element !== closedDetails.querySelector(":scope > summary")) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      }).length);
      const visited = new Set<string>();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let index = 0; index < expectedCount; index += 1) {
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) return null;
          const style = getComputedStyle(element);
          return {
            key: `${element.tagName}:${element.id}:${element.getAttribute("href") ?? ""}:${element.textContent?.trim() ?? ""}`,
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
          };
        });
        if (focused === null) {
          failures.push(`Chromium ${route.path} lost keyboard focus after ${String(index + 1)} tabs.`);
          break;
        }
        visited.add(focused.key);
        if (focused.outlineStyle === "none" || focused.outlineWidth < 2) {
          failures.push(`Chromium ${route.path} has an interactive element without a visible keyboard outline: ${focused.key}.`);
        }
      }
      if (visited.size !== expectedCount) {
        failures.push(`Chromium ${route.path} reached ${String(visited.size)} of ${String(expectedCount)} keyboard-focusable elements.`);
      }
    } finally {
      await context.close();
    }
  }
}

async function auditInteractionField(browser: import("playwright").Browser): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "no-preference",
    viewport: { width: 1440, height: 1024 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.mouse.move(320, 280);
    await page.waitForTimeout(80);
    const bloomCount = await page.locator(".pointer-light__bloom").count();
    if (bloomCount !== 3) {
      failures.push(`The interaction field rendered ${String(bloomCount)} internal blooms instead of 3.`);
    }

    const field = page.locator(".pointer-light");
    const morphBefore = await page.locator(".pointer-light__bloom--green").evaluate(
      (element) => getComputedStyle(element).clipPath,
    );
    await page.waitForTimeout(220);
    const morphAfter = await page.locator(".pointer-light__bloom--green").evaluate(
      (element) => getComputedStyle(element).clipPath,
    );
    const polygonAnimations = await field.evaluate((element) =>
      element.getAnimations({ subtree: true }).filter((animation) => {
        if (!(animation.effect instanceof KeyframeEffect)) return false;
        return animation.effect.getKeyframes().some(
          (frame) => typeof frame.clipPath === "string" && frame.clipPath.startsWith("polygon("),
        );
      }).length,
    );
    if (morphBefore === morphAfter || polygonAnimations < 5) {
      failures.push("The interaction field is not continuously morphing all five organic contours.");
    }

    await page.evaluate(() => window.scrollTo(0, 520));
    await page.waitForTimeout(80);
    const response = await field.evaluate((element) => ({
      activity: Number.parseFloat(element.style.getPropertyValue("--pointer-activity")),
      scaleY: Number.parseFloat(element.style.getPropertyValue("--pointer-scale-y")),
      visible: element.classList.contains("pointer-light--visible"),
    }));
    if (!response.visible || response.activity <= 0 || response.scaleY <= 1) {
      failures.push("The interaction field did not energize and change composition during scrolling.");
    }

    await page.mouse.down();
    await page.waitForTimeout(20);
    if (!(await field.evaluate((element) => element.classList.contains("pointer-light--pressed")))) {
      failures.push("The interaction field did not react to pointer press activity.");
    }
    await page.mouse.up();
  } finally {
    await context.close();
  }
}
