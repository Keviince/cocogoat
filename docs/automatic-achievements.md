# 自动更新成就

Fork 的 `Update achievements and publish fork` 工作流每小时检查一次，也支持手动运行和 main 分支推送。没有变化且上次运行成功的定时检查不构建、不发布；上次失败时自动重试构建和部署。

流程：拉取 amos-data 完整历史 → 按先后顺序读取每个正式版快照 → 为未知 ID 记录首次出现版本 → 锁定子模块提交 → 测试并构建网页、单文件版 → 推送数据 → 创建 GitHub Release → 部署 GitHub Pages。无需原项目的云存储或通知密钥，使用 GitHub 自带的 GITHUB_TOKEN。

## 版本和可见性

- 从上游 package.json 的 `1.0.0-CNRELWinX.Y.Z` 读取版本，不再填写 TARGET_VERSION。不认识的构建标记和测试版本不会发布。
- `achievementSync.json` 保存已处理的提交；即使漏跑多个版本，也会回放中间快照，不把全部新增 ID 归到最新版本。保留已有 versionMeta 人工修正。
- 仍保留旧版本的手写发布日期。新版本在上游正式版数据可用后显示，`versionObserved.json` 记录的是上游数据首次出现时间，**不是游戏实际开服时间**。上游如果提前放出 CNREL 数据，本项目也会提前显示；无需猜测未来更新日程。
- 上游删成就、改写历史、基线缺少版本、数据为空或格式变化时停止发布并由 Actions 报错。旧部署保留，修复后下次运行自动补齐。攻略链接依然来自社区接口，不属于成就目录更新。
- 成就目录、文本和扫描匹配表来自同一个已锁定的子模块。安装依赖不会再绕过同步流程拉取 main 最新提交。

## 首次启用

Fork 默认可能关闭定时 Actions，需要在仓库 Actions 页面启用一次，并允许工作流写入仓库。GitHub Pages 的构建来源选 GitHub Actions；若已通过 API 配置，无需重复操作。以后不需要逐版本手动运行、填写版本或改发布日期。

Release 包含 `cocogoat-local.html` 和 `cocogoat-web.tar.gz`。网站默认地址为 `https://<用户名>.github.io/<仓库名>/`，使用 hash 路由以支持项目子路径。原站点的个人数据同步接口和识别资源地址沿用现有配置。

本地更新：初始化子模块后执行 `pnpm update-data`，执行 `pnpm test:data` 检查同步逻辑。提交整个 `src/generated`（含子模块指针）即可。无需 ts-node 或 TARGET_VERSION。

GitHub 可能因长期无仓库活动暂停公共仓库的定时工作流，定时任务也可能排队延迟；这种托管限制需要重新启用。数据发布仍依赖 amos-data 提供正确的正式版快照。
