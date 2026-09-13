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

Windows 可运行仓库中的 `Install-DesktopShortcut.ps1` 创建桌面图标，或用 Edge 打开在线页面并选择“安装到桌面”。快捷方式使用 Edge 的独立应用窗口，不需要安装 Python。

## 数据边界

Crossref 按 ISSN 获取元数据，RSS 补充出版商的最新条目。DOI 去重，RSS 后续获得 DOI 时保留阅读记录标识；在线日期优先显示，正式刊期另行保留。附件类 Supplemental Material 不作为独立文章显示。普通社论、更正可能保留。

首次 Crossref 回填近 90 天，RSS 可能含更早记录；后续按元数据更新时间增量抓取并回看 7 天，避免延迟登记文章因发表日期较早而遗漏。历史存放在 `radar-history` 分支的压缩 SQLite 文件中，失败来源不会推进其同步时间或清空历史。上游原有的 `data` 分支保留，不参与本应用采集。

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
python -m pytest radar/test_radar.py -q
python radar/run.py sync --days 90 --workers 3
python radar/verify_site.py
python -m http.server 8767 --directory site
```

打开 http://localhost:8767/。仅重建页面可用 `python radar/run.py build`；仅更新核心组可加 `--group core10`。本地 SQLite 位于 `radar-data/`，生成网站位于 `site/`，均不提交到主分支。

新增期刊时在 `radar/journals.json` 增加一条配置：`id` 使用稳定 ISSN，填写 `name`、`issns`、`short_name`、`groups`、`rss_url`（如有）和 `enabled`。现有 55 本里挑选个人子集可直接通过页面“管理期刊与数据源”勾选；新增第 56 本及之后的采集对象仍需修改配置并提交。

Fork 后在 Settings → Pages 设置 GitHub Actions，启用本仓库 Actions，并将 Windows 脚本中的 URL 改为自己的地址。工作流需要本仓库的 contents write、pages write 和部署身份权限，仅保存采集记录与发布静态站点。

## 上游与许可

GitHub fork 保留上游历史与 MIT LICENSE。基线为 Paper Firehose v0.4.2，提交 `421e956b8ec3b6e49df2a7c8a9fa5d754a61c8e1`。复用其 SQLite 历史库管理、搜索索引维护、DOI 提取及 JATS 文本清理；`radar/` 增加期刊识别、Crossref 增量同步、来源健康检查及中文阅读界面。保留原文档于 `README.upstream.md`，原工作流移至 `.github/legacy-workflows/`，避免运行其模型、邮件和发布任务。
