# 期刊雷达 · Journal Radar

个人学术期刊追踪工具，基于 [Paper Firehose](https://github.com/zrbyte/paper-firehose) 二次开发。GitHub Actions 每日采集两次，GitHub Pages 提供阅读页面；Windows 桌面快捷方式或 PWA 以独立窗口打开。

**在线使用：https://linkingoscar.github.io/journal-radar/**

## 已接入清单

- 核心关注：用户指定的 10 本组织行为、人力资源与管理学期刊。
- FT50：2026 年 4 月版，依据 [SMU 图书馆核验的名单与 ISSN](https://library.smu.edu.sg/topics-insights/updating-your-ft50-search-strategies-verified-issns-literature-search-scopus-and)。此次更新加入 Academy of Management Annals、American Sociological Review、Psychological Science，移出 Human Relations、Journal of Business Ethics、Organization Studies。
- UTD24：依据 [UT Dallas 官方名单](https://jsom.utdallas.edu/the-utd-top-100-business-school-research-rankings/index.php)。
- 三组重叠去重后共 **55 本**。完整名称、ISSN、来源和分组保存在 `radar/journals.json`。

## 阅读

默认展示核心 10 本的近 90 天文章。可按期刊、日期、关键词筛选，切换未读与收藏，打开摘要和原文；浏览器首次载入后会缓存阅读页面和文章数据。

已读、收藏和“我的选刊”仅保存在当前浏览器，换设备或清除浏览器数据前请点击“导出阅读记录”。导入会合并记录。页面的“刷新文章”读取最新云端采集结果，不会立即启动一次采集。

Windows 桌面增强版：运行 `Install-DesktopShortcut.ps1` 安装本机组件并创建图标（安装时需要 Python 3.10+ 和 PowerShell 7；本机已安装）。双击桌面图标会静默启动采集组件，并用 Edge 独立窗口打开 `http://127.0.0.1:8766/`。日常使用不需要打开终端。

每次打开应用时先读取云端文章，再补采云端失败的 RSS；15 分钟内重复打开会复用现有结果，也可点击“本机补采”手动运行。电脑关机后云端继续按原计划采集，本机补采在下次打开应用时进行。本机文章历史位于 `.desktop-data/`，仅在本机合并显示，不自动上传 GitHub。后台组件只监听本机回环地址，不对局域网开放。

原网页版与本机版属于不同浏览器站点，收藏不会自动共享。首次进入本机版可点击“迁移原网页版阅读记录”，在同一浏览器内合并原有收藏、已读和自选期刊；也可使用 JSON 导出/导入。合并保留已有记录，DOI 去重时保留阅读标识。浏览器保存的 PWA 仍是网页版；需要本机补采时请使用安装脚本生成的桌面图标。

## 免费摘要翻译

桌面版和网页版均支持打开文章时自动将已有英文摘要译为中文，保留英文原文。可在“摘要翻译设置”关闭自动翻译，改为手动点击“翻译摘要”。翻译不会补造缺失摘要，也不会批量翻译所有历史文章。

默认使用 [MyMemory 官方免费 API](https://mymemory.translated.net/doc/spec.php)。英文摘要会发送给 MyMemory；译文使用 IndexedDB 缓存在当前浏览器，源摘要变化后重新翻译。长摘要按句子优先分段，每段不超过接口限制；机器翻译的术语和长句可能不准确，阅读时请对照原文。

[匿名版约 5,000 字符/天，提供有效联系邮箱可用约 50,000 字符/天](https://mymemory.translated.net/doc/usagelimits.php)。在「摘要翻译设置」中填写邮箱并点击「保存邮箱」启用邮箱版；可随时移除，恢复匿名版。邮箱仅存于当前浏览器，随翻译请求的 `de` 参数发送给 MyMemory，不写入公开仓库或阅读记录备份；桌面版与网页版需分别配置。更换邮箱不重置本机用量，已有缓存保持有效。本应用对当前站点近 24 小时发送量设上限，跨设备、其他站点或共享网络的服务端额度可能不同。已缓存译文不再调用服务；失败段可以重试并复用完成的分段，超额时保留原文。译文缓存不包含在阅读记录备份里，清除站点数据会清除缓存。无需 API key，不使用付费翻译接口。

## 数据边界

Crossref 按 ISSN 获取元数据，RSS 补充出版商的最新条目。DOI 去重，RSS 后续获得 DOI 时保留阅读记录标识；在线日期优先显示，正式刊期另行保留。附件类 Supplemental Material 不作为独立文章显示。普通社论、更正可能保留。

首次 Crossref 同时回填近 90 天发表和近 90 天登记的条目，RSS 可能含更早记录；后续按元数据更新时间增量抓取并回看 7 天，避免延迟登记文章因发表日期较早而遗漏。日期只提供年份或月份时按原精度展示，筛选时保留可能与时间范围重叠的记录。历史存放在 `radar-history` 分支的压缩 SQLite 文件中，失败来源不会推进其同步时间或清空历史。上游原有的 `data` 分支保留，不参与本应用采集。

**加入清单不代表来源完整覆盖。** 摘要可能缺失，Crossref 登记可能延迟，出版商 RSS 可能只返回部分最新文章或暂时拒绝访问。“管理期刊与数据源”展示每本期刊各来源的最近成功时间和错误。HBR 使用官方综合 feed，包含 Digital Articles，并非仅杂志论文；该刊 Crossref 期刊接口不可用。MIT Sloan Management Review 也主要依赖其网站 RSS。

## 自动更新与费用

计划北京时间 **09:23、21:23** 更新，GitHub 调度可能延迟。在仓库 Actions → Update Journal Radar → Run workflow 可手动运行。

当前使用公开仓库的标准 GitHub 托管 runner 和 Pages，不需要购买服务器、不调用付费 AI 接口。公开仓库与网站中的期刊配置和文章元数据可被访问，个人阅读记录不上传。GitHub 对长时间无仓库活动的定时任务可能自动停用，可在 Actions 重新启用；本项目每天保存采集状态产生仓库活动。平台政策以 [GitHub Actions 文档](https://docs.github.com/en/actions) 为准。

## 本地开发

Python 3.10+，在仓库根目录执行：

```sh
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
# Linux/macOS: source .venv/bin/activate
python -m pip install -r radar/requirements.txt pytest==8.4.2
python -m pytest radar/test_radar.py radar/test_desktop.py -q
node --test radar/test_translation.cjs
python radar/run.py sync --days 90 --workers 3
python radar/verify_site.py
python -m http.server 8767 --directory site
```

打开 http://localhost:8767/。仅重建页面可用 `python radar/run.py build`；仅更新核心组可加 `--group core10`。本地 SQLite 位于 `radar-data/`，生成网站位于 `site/`，均不提交到主分支。

新增期刊时在 `radar/journals.json` 增加一条配置：`id` 使用稳定 ISSN，填写 `name`、`issns`、`short_name`、`groups`、`rss_url`（如有）和 `enabled`。现有 55 本里挑选个人子集可直接通过页面“管理期刊与数据源”勾选；新增第 56 本及之后的采集对象仍需修改配置并提交。

Fork 后在 Settings → Pages 设置 GitHub Actions，启用本仓库 Actions。定制部署地址时同时修改 `radar/desktop.py` 中的 `CLOUD` 和 `radar/web/app.js` 中的迁移地址与来源校验；本机固定端口为 8766。工作流需要本仓库的 contents write、pages write 和部署身份权限，仅保存采集记录与发布静态站点。

## 上游与许可

GitHub fork 保留上游历史与 MIT LICENSE。基线为 Paper Firehose v0.4.2，提交 `421e956b8ec3b6e49df2a7c8a9fa5d754a61c8e1`。复用其 SQLite 历史库管理、搜索索引维护、DOI 提取及 JATS 文本清理；`radar/` 增加期刊识别、Crossref 增量同步、来源健康检查及中文阅读界面。保留原文档于 `README.upstream.md`，原工作流移至 `.github/legacy-workflows/`，避免运行其模型、邮件和发布任务。
