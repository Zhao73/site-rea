import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

/**
 * Cuts each section out of the full-page screenshot. Returns warnings for
 * sections that fall outside the image (pages taller than the capture limit).
 */
export function cropSectionScreenshots({ fullPagePath, sections, sectionsDir, maxSectionHeight = 4000 }) {
  const warnings = [];
  if (!fs.existsSync(fullPagePath)) return ["Full-page screenshot missing; section screenshots skipped."];
  const full = PNG.sync.read(fs.readFileSync(fullPagePath));
  fs.mkdirSync(sectionsDir, { recursive: true });

  for (const sec of sections) {
    const box = sec.boundingBox;
    if (!box) continue;
    const x = Math.max(0, Math.min(Math.round(box.x), full.width - 1));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.max(1, Math.min(Math.round(box.width), full.width - x));
    const h = Math.min(Math.round(box.height), maxSectionHeight, full.height - y);
    if (y >= full.height || h < 1) {
      warnings.push(`Section ${sec.index} lies below the captured page height; no screenshot.`);
      continue;
    }
    const out = new PNG({ width: w, height: h });
    for (let row = 0; row < h; row++) {
      const srcStart = ((y + row) * full.width + x) * 4;
      full.data.copy(out.data, row * w * 4, srcStart, srcStart + w * 4);
    }
    const file = path.join(sectionsDir, `section-${String(sec.index).padStart(2, "0")}.png`);
    fs.writeFileSync(file, PNG.sync.write(out));
    sec.screenshot = file;
    sec.screenshotClipped = box.height > maxSectionHeight;
  }
  return warnings;
}
