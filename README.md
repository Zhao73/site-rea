# Site-REA

**[中文](#中文) | [English](#english)**

<a id="中文"></a>

把一个网站录下来，在本机离线原样运行；或者转成能接着改的静态 / React 工程；并且断网验收，告诉你和原站差多少。

提供三种用法：MCP 服务器（14 个工具，给 Claude Code / Codex / Cursor / Antigravity 这类 AI 调用）、命令行、Antigravity 插件。

> 下面写的每一项能力都有实测数字。做不到的事单独列在"做不到的事"一节。

---

## 它能产出什么

| 产出 | 是什么 | 交互 | 适合 |
| :--- | :--- | :--- | :--- |
| **运行时镜像** `runtime-mirror` | 把网站的全部网络响应录下来，原站的 JavaScript 在本机对着录制内容运行 | 和原站一样（3D、动画、单页应用都在跑） | 离线存档、演示、研究一个网站是怎么做的 |
| **静态镜像** `static-mirror` | 把渲染完成的页面冻结成一份 HTML + CSS，不带脚本 | 无 | 留一份页面"标本" |
| **HTML 工程** `vanilla` | 同样的标记，每个区块加了标注，配原站 CSS | 无，需自己写 | 接着改成自己的静态站 |
| **React 工程** `react-vite-tailwind` | 每个区块一个 React 组件（HTML 已转成 JSX），配原站 CSS，Tailwind 可用 | 无，需自己写 | 接着改成自己的 React 站 |
| **滚动播片** `scroll-scrub` | 按滚动位置录下若干帧，用 canvas 随滚动播放 | 无 | 固定在屏幕上的滚动动画段落 |

另外每次抓取都会得到一份**证据目录**：桌面和手机整页截图、分区块截图、配色 / 字体 / CSS 变量、本地化的图片字体等素材、分区块的文案和结构、WebGL / WebGPU 着色器源码、Three.js 场景信息、脱敏后的接口样例。

---

## 实测结果

2026-11-21 用最终代码实测，全部在**断开外网**的条件下验收。数字是和原站截图逐像素对比的相似度。

### 运行时镜像（原站脚本在本机运行）

"精确回放"指 `site-rea open`：地址栏是原网址，录制内容在网络层应答。"本机服务器"指 `node server.mjs` 后打开 `http://127.0.0.1`。

| 网站 | 录到的响应 | 精确回放 · 桌面（首屏 / 整页 / 9 个滚动位置平均） | 精确回放 · 手机（首屏 / 整页） | 本机服务器 · 桌面 | 没录到的请求 |
| :--- | ---: | :--- | :--- | :--- | ---: |
| threejs.org 的 three.js 示例（WebGL 动画） | 15 | 100 / 100 / 100 | 100 / 100 | 100 / 100 / 100 | 0 |
| corp.shiseido.com/jp（传统企业站，轮播 + 同意弹窗） | 99 | 100 / 100 / 100 | 100 / 100 | 94.66 / 98.59 / 93.92 | 0 |
| linear.app（Next.js 单页应用） | 588 | 100 / 100 / 未采样 | 100 / 100 | 100 / 100 / 未采样 | 0 |
| lenis.dev（WebGL + 平滑滚动，页面高 37462px） | 169 | 100 / 100 / 99.53 | 100 / 95.32 | 100 / 99.97 / 100 | 0 |
| stripe.com（动态渐变首屏，683 个请求） | 683 | 97.04 / 99.36 / 99.33 | 95.10 / 99.36 | 99.93 / 99.89 / 99.84 | 0 |

说明：
- 资生堂在"本机服务器"下分数低，是因为它的 Cookie 同意弹窗放在第三方 iframe 里，本机服务器接管不了别的域名的 iframe（被拦下并记了 1 次外网请求）。精确回放没有这个问题。
- Stripe 的脚本会检查自己的域名，在 `127.0.0.1` 上会报 "hostname is not a recognized Stripe host"。精确回放下没有任何错误。首屏不到 100 是因为那块渐变动画每一帧都在变。
- lenis.dev 画面一致，但回放时 Next.js 的预取逻辑多报了一个原站没有的脚本错误（`t[Symbol.asyncIterator] is not a function`），原因没查明，肉眼没看到影响。
- 结论：**依赖自己域名或嵌了第三方 iframe 的网站，用精确回放；其余两种方式都可以。**

### 静态镜像与 React 工程（不带脚本）

React 工程是真实执行 `npm install && npx vite build` 后对 `dist/` 验收的，和静态镜像的分数相同（同一份标记和样式）。

| 网站 | 桌面（首屏 / 整页 / 滚动平均） | 手机（首屏 / 整页） |
| :--- | :--- | :--- |
| linear.app | 100 / 100 / 未采样 | 100 / 100 |
| three.js 示例 | 100 / 100 / 98.55 | 37.84 / 21.74 |
| corp.shiseido.com/jp | 100 / 97.94 / 94.00 | 43.95 / 18.19 |
| lenis.dev | 79.57 / 95.50 / 41.06 | 83.25 / 81.72 |
| stripe.com | 75.67 / 90.98 / 86.28 | 83.18 / 77.49 |

这组数字说明静态产物的边界：它是**桌面布局在页面顶部那一刻的快照**。靠脚本驱动的东西（滚动后才变化的页头、懒加载的轮播图、WebGL 画面、手机上由脚本重排的结构）不会跟着变。内容以静态排版为主的网站接近 100%，动效重的网站差得多。

### 滚动播片

lenis.dev 录 40 帧：首屏 100，整页 93.28，滚动位置平均 86.48。两帧之间画面是跳的，所以普通长页面效果一般；它只适合"固定在屏幕上、画面随滚动进度变化"的段落。

---

## 安装

需要 Node.js 18 以上。浏览器优先用 Playwright 安装的 Chrome for Testing，找不到才用系统里的 Chrome：

```bash
git clone https://github.com/Zhao73/site-rea.git
cd site-rea
npm install
npx playwright install chromium     # 装一个测试专用浏览器（推荐）
node bin/site-rea.mjs doctor        # 检查环境
```

接到 AI 工具里：

```bash
node bin/site-rea.mjs setup     # 打印 Claude Code / Codex / Cursor 的配置
npm run install:plugin          # 安装为 Antigravity 插件
```

---

## 用法

```bash
# 1. 抓取。页面有动画、轮播、3D、视频时加 --deterministic，验收才有意义
node bin/site-rea.mjs capture https://example.com --out ./work/.site-rea --deterministic

# 2a. 运行时镜像
node bin/site-rea.mjs scaffold ./work/.site-rea ./work/mirror --mode runtime-mirror
node ./work/mirror/server.mjs --port 4175           # 本机服务器，任何浏览器打开 http://127.0.0.1:4175
node bin/site-rea.mjs open ./work/mirror            # 精确回放：弹出浏览器窗口，地址是原网址，不联网（见"做不到的事"里的已知问题）

# 2b. 能改的代码
node bin/site-rea.mjs scaffold ./work/.site-rea ./work/site --mode react-vite-tailwind
cd ./work/site && npm install && npm run build

# 3. 验收（断网）
node bin/site-rea.mjs verify ./work/.site-rea --dir ./work/mirror
node bin/site-rea.mjs verify ./work/.site-rea --dir ./work/site/dist
```

其他命令：`timeline`（按滚动位置采样截图和 3D 轨迹）、`scrub`（录滚动播片的帧）、`ingest`（导入自己保存的 HTML / HAR，全程不联网）、`mock-backend`（由抓到的接口样例生成本地假后端）、`serve`（预览静态目录）。`node bin/site-rea.mjs help` 看全部参数。

### 抓取时做了什么

1. 用桌面（1440×900）和手机（390×844）各打开一次，录下全部网络响应，包括 POST、跳转、Worker 里的请求。
2. 把页面"走一遍"：整页滚动、悬停导航，让懒加载的脚本和图片也被录到。
3. 视频只会被播到的片段录下来，所以另外把完整文件补抓一次。
4. **预演**：断开外网把镜像跑起来，页面还在要、录制里没有的，由服务器补抓；重复到一轮下来不再缺东西。仍然补不到的写在结果的 `runtimeCache.rehearsal.unresolved` 里。

### 验收报告怎么读

- `offline.passed`：产物有没有试图联网、有没有缺文件。`false` 时 `offline.externalRequests` / `offline.misses` 会列出是哪些。
- 运行时镜像的结果在 `replayModes.exact` 和 `replayModes.portable` 里分别给出。
- `heroDiff` / `fullDiff` / `sectionDiffs` / `scrollTimelineDiffs`：首屏、整页、分区块、各滚动位置的相似度。
- 对比图在证据目录的 `verify/` 下，三联排列：原站 | 差异 | 克隆。数字低的时候先看图。
- 原站自己就有的控制台错误不算在克隆头上。

### 确定性模式（`--deterministic`）做了什么

为了让原站和克隆在"同一个状态"下被截图：

- 时间（`Date`、`performance.now`、`requestAnimationFrame`）换成虚拟时钟，起点是抓取那一刻。
- `Math.random` 换成带种子的序列，每个调用位置各有一条，随机排序的内容每次顺序相同。
- 2.4 秒及以上的定时器被暂停：自动轮播停在第一张，延迟弹出的窗口不会出现。
- 截图时 CSS 动画和视频被放到固定状态（有限动画跳到结束，循环动画按虚拟时间定相位，视频停在第一帧）。

它改变了页面的行为，所以默认不开；只在需要逐像素验收时用。

---

## 做不到的事

- **验证码、人机验证、登录墙**：遇到就停，返回 `status: "blocked"`，不做任何绕过。可以自己在浏览器里把页面存成 HTML / SingleFile / HAR，再用 `ingest` 导入。
- **实时连接**：WebSocket 没法从录制回放，镜像里会直接断开（聊天、实时行情这类功能不工作）。
- **抓取时没发生过的请求**：镜像只有录到的内容。没点开过的页面、没触发过的操作、没填过的表单，在镜像里是 404。目前一次只录一个页面。
- **静态镜像 / HTML 工程 / React 工程没有交互**：菜单、轮播、标签页、表单都要自己重写。它们是桌面布局的快照，手机上靠脚本重排的网站对不上（见上面的实测）。
- **React 工程的类名是原站的类名**，不是重新设计过的组件库。Tailwind 以 `tw:` 前缀安装、不带 Preflight，只供新写的部分使用。
- **3D 场景不会被自动重建成源码**。着色器、场景结构、相机轨迹会被抓下来当参考资料，重写要靠人或 AI。想要原样运行，用运行时镜像。
- **本机服务器方式的局限**：页面脚本看到的域名是 `127.0.0.1`，检查域名或写 Cookie 的脚本会报错；第三方 iframe 不在接管范围内。这两类用精确回放。
- **`site-rea open` 的窗口有已知问题**：在作者的机器上（macOS，多个桌面）浏览器启动了、内容也在回放，但窗口没有出现在当前桌面，原因没查明。上表"精确回放"的数字来自 `verify` 的无界面验收，不受影响。想亲眼看效果，先用本机服务器。
- **原站自己的 Service Worker** 在录制和回放时都被停用。
- 以下只在自带的测试页上验证过，没有在真实网站上测：WebGPU（WGSL）着色器抓取、本地假后端、HAR 导入、交互探测。

## 使用边界

把别人的网站原样克隆后公开发布，可能侵犯对方的版权和商标。镜像用于参考、存档，以及迁移你自己或客户自己的网站。

---

## MCP 工具（14 个）

| 工具 | 作用 |
| :--- | :--- |
| `capture_site` | 抓取一个在线网站，生成证据目录和录制内容 |
| `ingest_local_archive` | 导入本地保存的 HTML / HAR，不联网 |
| `capture_scroll_timeline` | 按滚动位置采样截图、着色器变量和 Three.js 相机 / 网格轨迹 |
| `capture_scroll_scrub` | 录滚动播片的帧并生成播放器 |
| `inspect_rich_media` | 查看抓到的 3D / 动效资料 |
| `get_design_tokens` | 读配色、字体、CSS 变量、阴影、圆角、关键帧 |
| `get_section_blueprint` | 读某个区块的结构、文案和截图 |
| `list_assets` | 列出本地化的素材 |
| `discover_routes` | 列出站内链接 |
| `probe_interaction` | 点击 / 悬停 / 填写后截图对比 |
| `scaffold_project` | 生成 5 种产出之一 |
| `scaffold_mock_backend` | 由接口样例生成本地假后端 |
| `verify_clone` | 断网验收并出对比图 |
| `check_environment` | 检查 Node 和浏览器 |

## 测试

```bash
npm test
```

三组：`smoke`（基本流程）、`advanced`（3D、时间轴、播片、假后端、离线导入）、`mirror`（跨域资源、滚动后才加载的脚本、POST、跳转、打印样式表；**把原站服务器关掉以后**，运行时镜像、静态版、HTML 版、React 版仍要和原站 99.5% 以上一致）。这些测试用的是自带测试页；真实网站的结果见上面的实测表。

---

<a id="english"></a>

# Site-REA (English)

Record a website and run it offline on your machine exactly as it was; or turn it into a static / React project you can keep working on; then verify the result against the original with the internet cut off.

Three ways to use it: an MCP server (14 tools, for AI clients such as Claude Code, Codex, Cursor, Antigravity), a CLI, and an Antigravity plugin.

> Every capability below comes with measured numbers. What it cannot do has its own section.

## What it produces

| Output | What it is | Behaviour | Good for |
| :--- | :--- | :--- | :--- |
| **Runtime mirror** `runtime-mirror` | Every network response of the site is recorded; the site's own JavaScript runs locally against the recording | Same as the original (3D, animation, SPAs keep running) | Offline archive, demos, studying how a site is built |
| **Static mirror** `static-mirror` | The rendered page frozen as one HTML + CSS, no scripts | None | A snapshot of the page |
| **HTML project** `vanilla` | The same markup with every block labelled, plus the site's CSS | None; you write it | Turning it into your own static site |
| **React project** `react-vite-tailwind` | One React component per block (HTML converted to JSX), the site's CSS, Tailwind available | None; you write it | Turning it into your own React site |
| **Scroll film** `scroll-scrub` | Frames recorded at scroll positions, played on a canvas as you scroll | None | A pinned, scroll-driven animation section |

Every capture also yields an **evidence directory**: desktop and mobile full-page screenshots, per-section screenshots, colours / fonts / CSS variables, localized images and fonts, per-section copy and structure, WebGL / WebGPU shader sources, Three.js scene information, and redacted API samples.

## Measured results

Measured on 2026-11-21 with the final code, always **with the internet cut off**. Numbers are pixel similarity against screenshots of the original.

### Runtime mirror (the site's scripts running locally)

"Exact replay" is `site-rea open`: the address bar shows the real URL and the recording answers at the network layer. "Local server" is `node server.mjs`, opened at `http://127.0.0.1`.

| Site | Responses recorded | Exact replay · desktop (hero / full page / mean of 9 scroll stops) | Exact replay · mobile (hero / full page) | Local server · desktop | Requests not recorded |
| :--- | ---: | :--- | :--- | :--- | ---: |
| three.js example on threejs.org (WebGL animation) | 15 | 100 / 100 / 100 | 100 / 100 | 100 / 100 / 100 | 0 |
| corp.shiseido.com/jp (classic corporate site, carousels + consent dialog) | 99 | 100 / 100 / 100 | 100 / 100 | 94.66 / 98.59 / 93.92 | 0 |
| linear.app (Next.js SPA) | 588 | 100 / 100 / not sampled | 100 / 100 | 100 / 100 / not sampled | 0 |
| lenis.dev (WebGL + smooth scroll, 37462 px tall) | 169 | 100 / 100 / 99.53 | 100 / 95.32 | 100 / 99.97 / 100 | 0 |
| stripe.com (animated gradient hero, 683 requests) | 683 | 97.04 / 99.36 / 99.33 | 95.10 / 99.36 | 99.93 / 99.89 / 99.84 | 0 |

Notes:
- Shiseido scores lower on the local server because its cookie-consent dialog lives in a third-party iframe, which the local server cannot take over (blocked and counted as 1 external request). Exact replay does not have this problem.
- Stripe's scripts check their own hostname and report "hostname is not a recognized Stripe host" on `127.0.0.1`. Under exact replay there are no errors. The hero is below 100 because that gradient changes every frame.
- lenis.dev looks identical, but during replay Next.js's prefetch logic throws one script error the original does not have (`t[Symbol.asyncIterator] is not a function`). The cause was not found; no visible effect was seen.
- In short: **sites that depend on their own domain or embed third-party iframes need exact replay; for the rest either way works.**

### Static mirror and React project (no scripts)

The React project was really built with `npm install && npx vite build` and `dist/` was verified. It scores the same as the static mirror (same markup, same styles).

| Site | Desktop (hero / full page / scroll mean) | Mobile (hero / full page) |
| :--- | :--- | :--- |
| linear.app | 100 / 100 / not sampled | 100 / 100 |
| three.js example | 100 / 100 / 98.55 | 37.84 / 21.74 |
| corp.shiseido.com/jp | 100 / 97.94 / 94.00 | 43.95 / 18.19 |
| lenis.dev | 79.57 / 95.50 / 41.06 | 83.25 / 81.72 |
| stripe.com | 75.67 / 90.98 / 86.28 | 83.18 / 77.49 |

These numbers show where static output ends: it is **a snapshot of the desktop layout at the top of the page**. Anything driven by script (a header that changes after scrolling, lazily loaded carousel images, WebGL, a DOM rebuilt for phones) does not follow. Sites that are mostly static layout come out near 100%; motion-heavy sites do not.

### Scroll film

lenis.dev with 40 frames: hero 100, full page 93.28, scroll mean 86.48. The picture jumps between two frames, so an ordinary long page does not look good; it only suits a section that is pinned to the screen while its picture follows scroll progress.

## Install

Node.js 18 or newer. The browser is Playwright's Chrome for Testing if present, otherwise an installed Chrome:

```bash
git clone https://github.com/Zhao73/site-rea.git
cd site-rea
npm install
npx playwright install chromium     # a dedicated testing browser (recommended)
node bin/site-rea.mjs doctor        # check the environment
```

Connect it to an AI client:

```bash
node bin/site-rea.mjs setup     # prints config for Claude Code / Codex / Cursor
npm run install:plugin          # installs the Antigravity plugin
```

## Usage

```bash
# 1. Capture. Add --deterministic when the page has animation, carousels, 3D or video,
#    otherwise pixel verification means little
node bin/site-rea.mjs capture https://example.com --out ./work/.site-rea --deterministic

# 2a. Runtime mirror
node bin/site-rea.mjs scaffold ./work/.site-rea ./work/mirror --mode runtime-mirror
node ./work/mirror/server.mjs --port 4175           # local server: open http://127.0.0.1:4175 in any browser
node bin/site-rea.mjs open ./work/mirror            # exact replay in a browser window under the real URL, offline (see the known issue below)

# 2b. Code you can edit
node bin/site-rea.mjs scaffold ./work/.site-rea ./work/site --mode react-vite-tailwind
cd ./work/site && npm install && npm run build

# 3. Verify (offline)
node bin/site-rea.mjs verify ./work/.site-rea --dir ./work/mirror
node bin/site-rea.mjs verify ./work/.site-rea --dir ./work/site/dist
```

Other commands: `timeline` (screenshots and 3D tracks per scroll position), `scrub` (frames for a scroll film), `ingest` (import HTML / HAR you saved yourself, no network at all), `mock-backend` (a local fake backend from recorded API samples), `serve` (preview a static directory). `node bin/site-rea.mjs help` lists every flag.

### What capture does

1. Opens the page at desktop (1440×900) and mobile (390×844) size and records every network response, including POSTs, redirects and requests made by workers.
2. Walks the page: scrolls through all of it and hovers the navigation, so lazily loaded scripts and images are recorded too.
3. Video is only recorded in the pieces that played, so each file is fetched once more in full.
4. **Rehearsal**: the mirror is run with the internet cut off; whatever the page still asks for that the recording lacks is fetched by the server, and this repeats until a pass needs nothing new. What still cannot be fetched is listed in `runtimeCache.rehearsal.unresolved`.

### Reading the verification report

- `offline.passed`: whether the output tried to reach the internet or lacked files. When `false`, `offline.externalRequests` / `offline.misses` name them.
- For a runtime mirror the results are given separately in `replayModes.exact` and `replayModes.portable`.
- `heroDiff` / `fullDiff` / `sectionDiffs` / `scrollTimelineDiffs`: similarity of the hero, the full page, each section and each scroll stop.
- Comparison images are in the evidence directory under `verify/`, three panels: Original | Diff | Clone. Look at the image before explaining a low number.
- Console errors the original page logs itself are not counted against the clone.

### What deterministic mode (`--deterministic`) does

So that the original and the clone are photographed in the same state:

- Time (`Date`, `performance.now`, `requestAnimationFrame`) runs on a virtual clock that starts at the moment of capture.
- `Math.random` becomes a seeded sequence, one per call site, so randomly ordered content comes out in the same order every time.
- Timers of 2.4 s or longer are held: autoplay carousels stay on their first slide and delayed pop-ups do not appear.
- At each screenshot CSS animations and videos are put into a fixed state (finite animations jump to their end, endless ones take a phase from the virtual time, videos stop on their first frame).

It changes how the page behaves, so it is off by default; use it when you need pixel verification.

## What it cannot do

- **CAPTCHAs, bot checks, login walls**: it stops and returns `status: "blocked"`. Nothing is bypassed. You can save the page from your own browser as HTML / SingleFile / HAR and import it with `ingest`.
- **Live connections**: a WebSocket cannot be replayed from a recording and is closed in the mirror (chat, live prices and the like do not work).
- **Requests that never happened during capture**: the mirror only has what was recorded. Pages not opened, actions not triggered and forms not submitted are 404 in the mirror. One page is recorded per capture.
- **Static mirror / HTML project / React project have no behaviour**: menus, carousels, tabs and forms have to be rewritten. They are snapshots of the desktop layout; sites that rebuild their DOM by script on phones do not match there (see the measurements).
- **The React project keeps the original site's class names**; it is not a redesigned component library. Tailwind is installed with the `tw:` prefix and without Preflight, for newly written parts only.
- **3D scenes are not rebuilt into source code.** Shaders, scene structure and camera tracks are captured as reference material; rewriting is up to a person or an AI. To run a scene as it is, use the runtime mirror.
- **Limits of the local server**: page scripts see `127.0.0.1` as their domain, so scripts that check the domain or set cookies complain; third-party iframes are outside its reach. Use exact replay for those.
- **Known issue with the `site-rea open` window**: on the author's machine (macOS, several desktops) the browser starts and the recording is replayed, but the window does not show up on the current desktop; the cause was not found. The "exact replay" numbers above come from headless verification and are not affected. To look at a mirror yourself, use the local server first.
- **The site's own service worker** is disabled during recording and replay.
- Verified only on the bundled test pages, not on real sites: WebGPU (WGSL) shader capture, the fake backend, HAR import, interaction probing.

## Acceptable use

Publishing a one-to-one clone of someone else's website can infringe their copyright and trademarks. Mirrors are for reference, archiving, and moving your own or your client's own site.

## MCP tools (14)

| Tool | What it does |
| :--- | :--- |
| `capture_site` | Captures a live site into an evidence directory plus the recording |
| `ingest_local_archive` | Imports locally saved HTML / HAR, no network |
| `capture_scroll_timeline` | Samples screenshots, shader uniforms and Three.js camera / mesh tracks per scroll position |
| `capture_scroll_scrub` | Records scroll-film frames and writes the player |
| `inspect_rich_media` | Shows the captured 3D / motion material |
| `get_design_tokens` | Colours, fonts, CSS variables, shadows, radii, keyframes |
| `get_section_blueprint` | Structure, copy and screenshot of one section |
| `list_assets` | Lists localized assets |
| `discover_routes` | Lists in-site links |
| `probe_interaction` | Before/after screenshots of a click / hover / fill |
| `scaffold_project` | Creates one of the five outputs |
| `scaffold_mock_backend` | Creates a local fake backend from API samples |
| `verify_clone` | Offline verification with comparison images |
| `check_environment` | Checks Node and the browser |

## Tests

```bash
npm test
```

Three suites: `smoke` (basic flow), `advanced` (3D, timeline, scroll film, fake backend, offline import), `mirror` (cross-origin assets, a script loaded only after scrolling, POST, redirect, print stylesheet; **with the original servers shut down**, the runtime mirror, static, HTML and React outputs must still match the original at 99.5% or better). These suites use bundled test pages; results on real sites are in the tables above.

## License

MIT
