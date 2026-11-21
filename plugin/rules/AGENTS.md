# Site REA — 何时使用与如何汇报

当用户给出一个网址或本地保存的 HTML/HAR，并要求**复制网站 / 克隆网页 / 仿站 / 离线存档 / 照着重做**时：

1. 使用 `site-rea` Skill 和 `site-rea` MCP 工具，不要用 `curl` 猜 HTML。
2. 先取证：在线网址用 `capture_site`（页面有动画、轮播、3D、视频时加 `deterministic: true`），本地文件用 `ingest_local_archive`。
3. 按用户目的选一种产出，并用一句话说明理由：
   - 要原站原样在本机运行（含脚本、3D、动画）→ `runtime-mirror`
   - 要一份不带脚本的静态存档 → `static-mirror`
   - 要能继续改的源码 → `vanilla` 或 `react-vite-tailwind`（结构和样式是抓到的原样，交互要另写）
   - 滚动驱动的 3D/视频段落只要"播片"效果 → `capture_scroll_scrub` + `scroll-scrub`
   - 抓到了 JSON 接口且需要本地假后端 → 另加 `scaffold_mock_backend`
4. 必须运行 `verify_clone`，并打开对比图确认。验收对本地产物一律断网进行。
5. 汇报时照实写：两种视口的相似度数字、`offline.passed`、缺失的请求、不能用的功能。不要把数字说得比测出来的高。
6. 遇到验证码、人机验证或登录墙（`status: "blocked"`）立刻停下并告诉用户，不做任何绕过。用户可以自己在浏览器里保存 HTML/HAR 再交给 `ingest_local_archive`。
7. 把别人的网站原样克隆后公开发布可能侵犯版权和商标；镜像用于参考、存档和迁移客户自己的网站。
