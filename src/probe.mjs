import fs from "node:fs";
import path from "node:path";
import { launchBrowser, detectBlockedPage, scrollAndSettlePage } from "./browser.mjs";

export async function probeInteraction({
  url,
  evidenceDir,
  action = "click",
  selector,
  value,
  viewport = "desktop",
  waitAfterMs = 600,
  timeoutMs = 30000,
}) {
  if (!url) throw new Error("url is required");
  if (!selector && action !== "scroll") throw new Error("selector is required for click/hover/fill");

  const outDir = path.join(path.resolve(evidenceDir), "interactions");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = Date.now();
  const vp = viewport === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const { browser } = await launchBrowser();

  try {
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }
    await scrollAndSettlePage(page, { waitMs: 500 });

    const blockCheck = await detectBlockedPage(page, response);
    if (blockCheck.blocked) {
      return { status: "blocked", ...blockCheck };
    }

    const locateTarget = () => {
      if (!selector) return null;
      if (selector.startsWith("text=")) return page.locator(selector).first();
      return page.locator(selector).first();
    };

    const snapshotState = async () =>
      await page.evaluate((sel) => {
        const visibleDialogs = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='dropdown'], [class*='menu']"))
          .filter((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0 && r.width > 10 && r.height > 10;
          })
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            textPreview: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140),
          }));

        let targetStyle = null;
        if (sel && !sel.startsWith("text=")) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const s = getComputedStyle(el);
              targetStyle = {
                backgroundColor: s.backgroundColor,
                color: s.color,
                transform: s.transform,
                boxShadow: s.boxShadow,
                borderColor: s.borderColor,
                opacity: s.opacity,
                ariaExpanded: el.getAttribute("aria-expanded"),
                ariaSelected: el.getAttribute("aria-selected"),
              };
            }
          } catch {}
        }

        return {
          url: location.href,
          scrollY: window.scrollY,
          bodyTextLength: (document.body?.innerText || "").length,
          visibleDialogs,
          targetStyle,
          expandedCount: document.querySelectorAll("[aria-expanded='true'], details[open]").length,
        };
      }, selector);

    const beforeState = await snapshotState();
    const beforeShot = path.join(outDir, `probe-${stamp}-before.png`);
    await page.screenshot({ path: beforeShot });

    const locator = locateTarget();
    if (action === "click") {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 8000 });
    } else if (action === "hover") {
      await locator.scrollIntoViewIfNeeded();
      await locator.hover({ timeout: 8000 });
    } else if (action === "fill") {
      await locator.scrollIntoViewIfNeeded();
      await locator.fill(value ?? "", { timeout: 8000 });
    } else if (action === "scroll") {
      const y = Number(value) || 900;
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    }

    await page.waitForTimeout(waitAfterMs);
    const afterState = await snapshotState();
    const afterShot = path.join(outDir, `probe-${stamp}-after.png`);
    await page.screenshot({ path: afterShot });

    const styleChanges = {};
    if (beforeState.targetStyle && afterState.targetStyle) {
      for (const k of Object.keys(beforeState.targetStyle)) {
        if (beforeState.targetStyle[k] !== afterState.targetStyle[k]) {
          styleChanges[k] = {
            before: beforeState.targetStyle[k],
            after: afterState.targetStyle[k],
          };
        }
      }
    }

    return {
      status: "ok",
      action,
      selector,
      viewport,
      urlChanged: beforeState.url !== afterState.url,
      beforeUrl: beforeState.url,
      afterUrl: afterState.url,
      bodyTextDelta: afterState.bodyTextLength - beforeState.bodyTextLength,
      expandedCountDelta: afterState.expandedCount - beforeState.expandedCount,
      newVisibleOverlays: afterState.visibleDialogs.filter(
        (d) => !beforeState.visibleDialogs.some((b) => b.textPreview === d.textPreview)
      ),
      styleChanges,
      screenshots: {
        before: beforeShot,
        after: afterShot,
      },
    };
  } finally {
    await browser.close();
  }
}
