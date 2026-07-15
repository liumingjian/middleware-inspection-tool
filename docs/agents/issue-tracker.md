# Issue tracker: GitHub

本仓库的 Issues、Wayfinder 地图和设计票据均使用 GitHub Issues 管理。所有操作使用 `gh` CLI，并从当前仓库的 `origin` 推断 `liumingjian/middleware-inspection-tool`。

## Conventions

- **创建 Issue**：`gh issue create --title "..." --body "..."`
- **读取 Issue**：`gh issue view <number> --comments`
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,assignees`
- **评论**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

创建 GitHub Issue。

## When a skill says "fetch the relevant ticket"

运行 `gh issue view <number> --comments`。

## Wayfinding operations

- **Map**：一个带 `wayfinder:map` 标签的 GitHub Issue，保存 Destination、Notes、Decisions so far、Not yet specified 和 Out of scope。
- **Child ticket**：使用 GitHub sub-issues API 连接到地图，并添加 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task` 标签。
- **Blocking**：优先使用 GitHub 原生 issue dependencies。调用 `POST repos/liumingjian/middleware-inspection-tool/issues/<child>/dependencies/blocked_by`，其中 `issue_id` 必须是 blocker 的数据库 ID，而不是 Issue 编号。
- **Frontier**：地图中所有未关闭、无开放 blocker、无 assignee 的子 Issue；按地图顺序选择第一项。
- **Claim**：开始处理票据前，首先运行 `gh issue edit <number> --add-assignee @me`。
- **Resolve**：在子 Issue 发布 resolution comment，关闭子 Issue，再把一句结论及其链接追加到地图的 Decisions so far。

## Migration note

`wayfinder/*.md` 是迁移到 GitHub 前的本地规划快照。迁移完成后，GitHub Issue 是 canonical tracker；本地文件仅保留作为版本化参考，不再用于判断票据状态或 frontier。
