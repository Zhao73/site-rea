import fs from "node:fs";
import path from "node:path";

/**
 * One clock per evidence directory. The epoch is the moment of capture, so a
 * replay sees the same "now" the original page saw: dates rendered on the
 * server still match what the page computes while hydrating.
 */
export function getEvidenceClock(evidenceDir, { create = false } = {}) {
  const file = path.join(evidenceDir, "clock.json");
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Number.isFinite(saved.startTimeMs)) return { seed: saved.seed >>> 0 || 1337, startTimeMs: saved.startTimeMs };
    } catch {}
  }
  if (!create) {
    // Evidence captured before clock.json existed used this fixed epoch.
    return { seed: 1337, startTimeMs: 1700000000000 };
  }
  const clock = { seed: 1337, startTimeMs: Math.floor(Date.now() / 1000) * 1000 };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clock, null, 2) + "\n", "utf8");
  return clock;
}

/**
 * Virtual time of the first locked frame. While the page loads, virtual time
 * runs with real frames but stops just short of this value, so the first lock
 * always lands on exactly the same instant however long loading took.
 */
export const FIRST_LOCK_MS = 5000;

/**
 * Deterministic Virtual Clock & Seeded PRNG init script.
 * Injected via page.addInitScript() before page JS executes when deterministic mode is enabled.
 * Eliminates uTime / rAF / Date.now / Math.random drift between original capture and clone verification!
 */
export function buildDeterministicClockInitScript({ seed = 1337, startTimeMs = 1700000000000, frameStepMs = 16.6667 } = {}) {
  return `(() => {
  if (window.__SITE_REA_CLOCK__) return;

  // Seeded Math.random with one independent stream per call site. A single
  // shared stream would hand a carousel's shuffle different numbers whenever
  // some other script happened to draw first; keyed by the caller, the same
  // line of code gets the same sequence on every load.
  const BASE_SEED = (${Number(seed) >>> 0}) || 1337;
  const randomStreams = new Map();
  function callSiteKey() {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 3;
    const stack = String(new Error().stack || "");
    Error.stackTraceLimit = limit;
    const lines = stack.split("\\n");
    // [0] "Error", [1] callSiteKey, [2] Math.random, [3] the caller
    const frame = lines[3] || lines[lines.length - 1] || "";
    // The host differs between the real site and a local mirror; the path does not.
    return frame.replace(/https?:\\/\\/[^/\\s)]+/g, "").trim();
  }
  function hashString(str) {
    let h = 2166136261 ^ BASE_SEED;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  Math.random = function () {
    const key = callSiteKey();
    let state = randomStreams.get(key);
    if (state === undefined) state = hashString(key) || BASE_SEED;
    state = (state + 0x6D2B79F5) | 0;
    randomStreams.set(key, state);
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const FRAME_MS = ${Number(frameStepMs) || 16.6667};
  const EPOCH_BASE = ${Number(startTimeMs) || 1700000000000};
  const FREE_RUN_CAP = ${FIRST_LOCK_MS - 100};
  let virtualPerfNow = 0;
  let frozen = false;
  let capFreeRun = true;
  let lastRealFrame = -1;
  let nextRafId = 1;
  const rafQueue = new Map();

  // Slow timers are what drive autoplaying carousels, rotating headlines and
  // delayed pop-ups. Whether one has fired by the time a screenshot is taken
  // depends on how long the page took to load, so the original and a clone
  // would be caught on different slides. They are held; quick timers
  // (initialisation, debounce, reveal delays) run normally.
  const LONG_TIMER_MS = 2400;
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  const heldTimers = new Set();
  let nextHeldId = 2000000000;
  let heldTotal = 0;
  window.setTimeout = function (cb, delay, ...args) {
    if (typeof cb === "function" && Number(delay) >= LONG_TIMER_MS) {
      heldTotal++;
      const id = nextHeldId++;
      heldTimers.add(id);
      return id;
    }
    return realSetTimeout(cb, delay, ...args);
  };
  window.setInterval = function (cb, delay, ...args) {
    if (typeof cb === "function" && Number(delay) >= LONG_TIMER_MS) {
      heldTotal++;
      const id = nextHeldId++;
      heldTimers.add(id);
      return id;
    }
    return realSetInterval(cb, delay, ...args);
  };
  window.clearTimeout = function (id) {
    if (heldTimers.delete(id)) return;
    return realClearTimeout(id);
  };
  window.clearInterval = function (id) {
    if (heldTimers.delete(id)) return;
    return realClearInterval(id);
  };

  // CSS animations, transitions and videos run on the browser's own clock.
  // At a locked frame they are put into a state that depends only on the
  // virtual time: finished if finite, at phase = virtual time if endless,
  // and videos paused on their first frame.
  function normalizeMedia() {
    let videos = 0;
    try {
      for (const anim of document.getAnimations()) {
        if (anim.timeline && anim.timeline !== document.timeline) continue; // scroll-driven: already a function of scroll
        const timing = anim.effect && anim.effect.getComputedTiming ? anim.effect.getComputedTiming() : null;
        try {
          if (timing && timing.iterations === Infinity) {
            anim.pause();
            anim.currentTime = virtualPerfNow;
          } else {
            anim.finish();
          }
        } catch {}
      }
    } catch {}
    try {
      for (const v of document.querySelectorAll("video")) {
        videos++;
        try {
          v.pause();
          if (v.currentTime !== 0) v.currentTime = 0;
        } catch {}
      }
    } catch {}
    return videos;
  }

  const origPerfNow = performance.now.bind(performance);
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCancelRaf = window.cancelAnimationFrame.bind(window);
  const OrigDate = Date;

  performance.now = function () {
    return virtualPerfNow;
  };

  class DeterministicDate extends OrigDate {
    constructor(...args) {
      if (args.length === 0) {
        super(EPOCH_BASE + Math.floor(virtualPerfNow));
      } else {
        super(...args);
      }
    }
    static now() {
      return EPOCH_BASE + Math.floor(virtualPerfNow);
    }
  }
  window.Date = DeterministicDate;

  window.requestAnimationFrame = function (cb) {
    const id = nextRafId++;
    rafQueue.set(id, cb);
    if (!frozen) {
      origRaf((realTs) => {
        if (frozen) return;
        const fn = rafQueue.get(id);
        if (!fn) return;
        rafQueue.delete(id);
        // One step of virtual time per real frame, however many callbacks share it.
        if (realTs !== lastRealFrame) {
          lastRealFrame = realTs;
          const next = virtualPerfNow + FRAME_MS;
          virtualPerfNow = capFreeRun ? Math.max(virtualPerfNow, Math.min(next, FREE_RUN_CAP)) : next;
        }
        try { fn(virtualPerfNow); } catch (e) { console.error(e); }
      });
    }
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    rafQueue.delete(id);
    return origCancelRaf(id);
  };

  function flushOneFrame(dt = FRAME_MS) {
    virtualPerfNow += dt;
    const pending = Array.from(rafQueue.entries());
    rafQueue.clear();
    for (const [, fn] of pending) {
      try { fn(virtualPerfNow); } catch (e) { console.error(e); }
    }
  }

  window.__SITE_REA_CLOCK__ = {
    seed: ${Number(seed) >>> 0},
    now: () => virtualPerfNow,
    isFrozen: () => frozen,
    setFrozen(flag) {
      frozen = Boolean(flag);
    },
    step(frames = 1, dt = FRAME_MS) {
      const n = Math.max(1, Math.min(300, Math.floor(frames)));
      for (let i = 0; i < n; i++) {
        flushOneFrame(dt);
      }
      return virtualPerfNow;
    },
    advanceTo(targetMs, dt = FRAME_MS) {
      frozen = true;
      capFreeRun = false;
      let guard = 0;
      while (virtualPerfNow < targetMs && guard < 300) {
        flushOneFrame(Math.min(dt, targetMs - virtualPerfNow));
        guard++;
      }
      virtualPerfNow = Math.max(virtualPerfNow, targetMs);
      // Run one final draw pass at the exact target timestamp
      flushOneFrame(0);
      const videos = normalizeMedia();
      flushOneFrame(0);
      return { now: virtualPerfNow, videos, heldTimers: heldTotal };
    },
    heldTimerCount: () => heldTotal,
    realSetTimeout,
    realNow: () => origPerfNow(),
  };
})();`;
}

export async function lockDeterministicFrame(page, targetMs = 1000) {
  const state = await page.evaluate((tMs) => {
    if (window.__SITE_REA_CLOCK__) {
      return window.__SITE_REA_CLOCK__.advanceTo(tMs);
    }
    return null;
  }, targetMs);
  if (state && state.videos > 0) {
    // Rewinding a video is asynchronous; the frame is only there once it has seeked.
    await page
      .evaluate(() => {
        const wait = (window.__SITE_REA_CLOCK__ && window.__SITE_REA_CLOCK__.realSetTimeout) || setTimeout;
        return Promise.all(
          Array.from(document.querySelectorAll("video")).map(
            (v) =>
              new Promise((resolve) => {
                if (!v.seeking) return resolve();
                v.addEventListener("seeked", () => resolve(), { once: true });
                wait(resolve, 1200);
              })
          )
        );
      })
      .catch(() => {});
  }
  return state ? state.now : null;
}
