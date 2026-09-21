# 开发与部署

[返回项目首页](../README.md) · [使用指南](user-guide.md) · [数据恢复](data-recovery.md)

## 环境要求

| 工具                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| Python 3.10+        | 采集、静态站点生成、本机增强服务；CI 使用 3.11        |
| Node.js 24 / npm    | 前端测试和 Prettier；在线阅读无需安装                 |
| Git                 | 克隆与版本管理                                        |
| GitHub CLI `gh`     | 下载或发布 Release 快照，需要登录可访问目标仓库的账号 |
| PowerShell 7 / Edge | 仅 Windows 桌面安装与启动需要                         |

阅读应用使用 `radar/requirements.txt`，开发检查使用 `radar/dev-requirements.txt`。根目录的 `pyproject.toml`、`requirements.txt` 属于保留的上游 CLI；开发期刊雷达无需安装其模型等重型依赖。

## 本地运行

### 1. 克隆并准备环境

```sh
git clone https://github.com/linkingoscar/journal-radar.git
cd journal-radar
python -m venv .venv
```

激活环境，按系统选择一条：

```powershell
# Windows / PowerShell
.\.venv\Scripts\Activate.ps1
```

```sh
# Linux / macOS
source .venv/bin/activate
```

再安装依赖：

```sh
python -m pip install -r radar/dev-requirements.txt
npm ci --ignore-scripts
```

### 2. 恢复历史并预览

先安装 GitHub CLI 并执行 `gh auth login`。以下恢复命令适用于新克隆、尚无 `radar-data/history.db` 的目录，读取本仓库已经验证的快照：

```sh
python radar/snapshots.py restore --repo linkingoscar/journal-radar
python radar/run.py build
python radar/verify_site.py
python -m http.server 8767 --bind 127.0.0.1 --directory site
```

打开 <http://127.0.0.1:8767/>。修改 `radar/web/` 后重新运行 `python radar/run.py build`；浏览器若提示“新版本已就绪”，点击“更新页面”。预览服务器用 `Ctrl+C` 结束。

已有数据库时直接构建，不需要再次恢复。恢复工具会拒绝覆盖已有文件；需要核验另一份快照时使用新的 `--database` 路径，见[数据恢复](data-recovery.md)。

### 3. 需要更新采集数据时

```sh
python radar/run.py sync --days 90 --workers 3
python radar/abstracts.py --limit 1000
python radar/verify_site.py
```

`sync` 会请求外部来源、写入本地 SQLite 并重建站点；仅预览样式不需要运行。可加 `--group hr35` 只更新人力与组织分组。没有历史快照时也可用 `sync` 开始首次采集，首轮范围和来源覆盖见[使用指南](user-guide.md#数据边界)。

## 开发检查

在已激活的虚拟环境和仓库根目录中运行：

```sh
python -B -m pytest radar -q -p no:cacheprovider
ruff format --check radar --no-cache
npm run format:check
npm test
```

`npm run format` 与 `ruff format radar --no-cache` 用于整理格式。第三方 `citeproc.js` 和生成的 `catalog.js` 不参与 Prettier 格式化。只改文档时检查链接、命令和实际渲染即可；行为变更运行相关测试，界面变更同时检查桌面与手机视口。

## 部署自己的实例

### 1. Fork 与 Pages 设置

Fork 本仓库到自己的 GitHub 账号并克隆自己的仓库，按前面的步骤安装依赖。在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，启用仓库 Actions。设置位置参见 [GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

### 2. 初始化自己的恢复快照

Fork 中的 `state/snapshot.json` 最初仍指向原仓库的 Release 标签，而工作流会从当前仓库下载附件。因此首次手动运行工作流前，先为自己的仓库发布一份种子快照。

以下命令在**自己的新克隆**中执行，将 `YOUR_NAME/journal-radar` 替换为自己的仓库。`gh` 需要拥有该仓库的 Release 与代码写入权限：

```sh
# 若已经完成前面的恢复并有本地 history.db，跳过这一行
python radar/snapshots.py restore --repo linkingoscar/journal-radar

# 此步骤会向自己的仓库上传 Release，并更新本地快照指针
python radar/snapshots.py publish --repo YOUR_NAME/journal-radar --tag radar-data-seed-initial
git add state/snapshot.json
git commit -m "Initialize durable data snapshot"
git push origin main
```

种子发布会重新下载并校验数据库。只需初始化一次；若采用空白采集而非原仓库历史，可以先执行 `python radar/run.py sync --days 90 --workers 3`，再发布自己的种子快照。

### 3. 修改部署地址

网页静态资源使用相对路径。本机组件和跨站阅读迁移使用明确的地址与来源校验；部署到自己的域名或项目路径时，应同步调整：

| 文件                                                            | 需要核对的配置                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| [`radar/desktop.py`](../radar/desktop.py)                       | `CLOUD`：自己的 Pages 地址下的 `data.json`                   |
| [`radar/web/app.js`](../radar/web/app.js)                       | 迁移窗口 URL、接收消息的来源、发送迁移消息时的域名和路径判断 |
| [`Install-DesktopShortcut.ps1`](../Install-DesktopShortcut.ps1) | `AppUrl` 默认值，与自己的站点一致                            |
| `README.md`                                                     | 在线体验地址、仓库地址与工作流徽章                           |

迁移仍需校验准确的来源和窗口身份；不要将来源检查改成允许任意域名。本机默认端口为 `8766`。

### 4. 首次发布与日常更新

在 **Actions → Update Journal Radar → Run workflow** 手动执行一次，待 `collect` 与 `deploy` 均成功后访问 Pages 地址。[GitHub 官方手动运行说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)介绍了此入口。

- 计划任务为 UTC `01:23`、`13:23`，即北京时间 `09:23`、`21:23`；调度可能延迟。
- 工作流执行格式检查与回归测试，再恢复、采集、补摘要、验证快照并发布。
- 采集任务需要 `contents: write`、`pages: write`；部署任务还需要 `id-token: write`，已在工作流中声明。组织策略可能进一步限制权限。
- 发布后的快照指针提交不会递归触发采集。仅修改 README 或 `docs/` 也不会触发采集工作流。
- 保留最近 14 份自动恢复快照、当前指针版本与长期种子；Pages 构建附件保留 1 天。

更新后的页面通过服务工作线程提示用户刷新。变更应用静态资源时应按现有模式更新 `radar/web/sw.js` 中的缓存版本。

## 模块与持久数据

`app.js` 协调页面，并将文章卡片、空列表、采集状态与焦点恢复分开维护。阅读状态、数据加载、筛选和备份分别由 `state.js`、`data.js`、`feed.js`、`backup.js` 处理；收藏操作与常用筛选分别在 `favorites.js`、`filters.js` 中。

Python 端的 `run.py` 负责采集与导出，`desktop.py` 提供本机服务，`snapshots.py` 负责可验证的云端恢复快照，`site_data.py` 生成网站分片。上游核心保留在 `src/paper_firehose/`。

| 路径                                             | 内容与清理边界                                     |
| ------------------------------------------------ | -------------------------------------------------- |
| `radar-data/`                                    | 开发采集数据库，属于持久数据，不提交               |
| `.desktop-data/`                                 | 本机历史、目录、个人期刊配置和封面，不能按缓存清理 |
| `site/`                                          | 生成的静态站点，可重新构建，不提交                 |
| `.venv/`、`.desktop-venv/`、`node_modules/`      | 安装的依赖，重装可恢复，不提交                     |
| `__pycache__/`、`.pytest_cache/`、`.ruff_cache/` | 可再生成的开发缓存，不提交                         |

验证结束后关闭对应预览服务并清理临时目录，保留必要结论即可。个人阅读备份、数据库、令牌与测试数据不得提交到公开仓库。历史分支说明见[分支归并记录](branch-consolidation.md)。
