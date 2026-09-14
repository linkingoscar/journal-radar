# 分支归并记录（2026-09-14）

维护分支统一为 `main`。当前期刊雷达的历史库从 `radar-history` 迁入 `main/state/history.db.gz`，自动采集直接从主线恢复并向主线提交状态。工作流保存时基于最新主线，推送遇到并发代码提交会重新获取并 rebase；无法合并则失败，不强制覆盖。

迁移源为 `b67d74820abba1a8b32c4f8abfdf6f5703ec26e7`：SQLite 完整性检查通过，包含 4,087 条底层文章记录、1,341 条摘要缓存记录；网站导出为 78 本期刊、4,078 篇文章（过滤附件等记录）。整个数据库直接迁移，包含来源健康状态与重试信息。后续采集会继续更新这些数字。

旧分支先以 Git 标签归档，再在主线工作流恢复、保存及发布成功后删除分支引用。标签保留原提交及其全部历史，可用于找回旧版本。

| 原分支 | 处理依据 | 归档标签 |
| --- | --- | --- |
| `radar-history` | 当前采集数据库完整迁入主线；工作流取消对此分支的依赖 | `archive/2026-09-14/radar-history` |
| `backup-before-rewrite` | 所有提交已包含在主线历史中 | `archive/2026-09-14/backup-before-rewrite` |
| `main-legacy-version` | 旧程序的模型输出限制、提示词与清理逻辑；现版已有按发表日期清理逻辑，无需恢复旧根目录脚本 | `archive/2026-09-14/main-legacy-version` |
| `ek-server-version` | 仅旧版本清理与忽略规则，没有需要移植的现版功能 | `archive/2026-09-14/ek-server-version` |
| `data` | 旧材料、物理、钙钛矿等主题数据，与当前管理学期刊库无关；保留历史，不混入当前文章 | `archive/2026-09-14/data` |

如需检查旧版本，可在 GitHub 的 Tags 中选择对应标签。恢复分支示例：

```sh
git fetch origin tag archive/2026-09-14/main-legacy-version
git switch -c restored-legacy archive/2026-09-14/main-legacy-version
```

迁移验证使用隔离的本地 Git 远端执行真实工作流恢复和保存脚本，检查文章与摘要缓存数量、修改后的数据可持久化，以及采集期间出现的新代码提交仍被保留。该验证不会修改生产数据库。
