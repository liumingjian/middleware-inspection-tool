# db-check 架构与 Tomcat MVP 复用调研

调研对象：[`liumingjian/db-check`](https://github.com/liumingjian/db-check)，源码快照 commit：[`337664c18de63276dbfa21442583c345b7d87751`](https://github.com/liumingjian/db-check/tree/337664c18de63276dbfa21442583c345b7d87751)。本报告只依据仓库 README、源码、依赖清单、启动配置、契约 schema 等一手资料。

## 1. 后端 / 前端技术栈和关键依赖

### 后端与采集端

- **Go 1.24** 是后端服务与客户侧采集器的主语言：`go.mod` 声明 `module dbcheck` 与 `go 1.24.0`，README 也要求 Go `1.24+`。[`go.mod`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/go.mod#L1-L14)，[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L53-L56)
- Go 关键依赖：MySQL 驱动 `github.com/go-sql-driver/mysql`、Oracle 驱动 `github.com/sijms/go-ora/v2`、GaussDB/openGauss 驱动 `gitee.com/opengauss/openGauss-connector-go-pq`、SSH/SFTP 相关 `golang.org/x/crypto` 与 `github.com/pkg/sftp`、系统指标 `github.com/shirou/gopsutil/v3`、结构化日志 `go.uber.org/zap`、WebSocket `nhooyr.io/websocket`。[`go.mod`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/go.mod#L4-L14)
- **Python 3.10+** 用于 analyzer/reporter pipeline，依赖非常轻：`jsonschema` 校验契约，`python-docx` 渲染 Word 报告。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L169-L181)，[`requirements.txt`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/requirements.txt#L1-L2)
- 后端 Web 服务入口是 `reporter/cmd/db-web`，HTTP handler 暴露 `/api/reports/generate`、`/api/reports/status/`、`/api/reports/download/`、`/api/reports/ws/`；WebSocket 使用 `nhooyr.io/websocket`。[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L60-L70)，[`reporter/internal/web/ws_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/ws_handler.go#L8-L43)

### 前端

- 前端位于 `web/`，是 **Next.js 16 + React 19 + TypeScript + Tailwind CSS 4** 应用。`package.json` 声明 `next dev/build/start/lint` 脚本。[`web/package.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/package.json#L4-L9)
- 关键前端依赖包括 `next@16.1.6`、`react@19.2.3`、`react-dom@19.2.3`、`zustand`、`lucide-react`、`@base-ui/react`、`class-variance-authority`、`clsx`、`tailwind-merge`、`shadcn`。[`web/package.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/package.json#L10-L32)
- 前端主页面是三步流程：选择数据库类型、上传文件、生成报告。[`web/src/app/page.tsx`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/src/app/page.tsx#L8-L31)

## 2. 目录与模块组织

README 给出的顶层组织为：`collector/` Go 采集端、`analyzer/` Python 分析端、`reporter/` 报告生成与 Word 渲染、`contracts/` schema 与样例、`rules/` 检查规则、`scripts/` 构建辅助、`tests/` 测试、`docs/` 文档中心、`web/` 前端。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L468-L483)

更细分看：

- `collector/cmd/db-collector`：客户侧采集器 CLI 入口；`collector/cmd/db-osprobe`：远程 OS helper。
- `collector/internal/mysql`、`collector/internal/oracle`、`collector/internal/gaussdb`：不同数据库的采集模块；`collector/internal/osinfo`：本地/远程 OS 指标；`collector/internal/output`：运行目录与 JSON/text 写入。
- `analyzer/evaluator`：规则目录、适用性、JSON path 抽取、阈值/规则引擎。
- `reporter/cli/reporter_orchestrator.py`：串联 analyzer、元数据、ReportView、DOCX 渲染、契约校验的总编排入口。[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L19-L28)
- `reporter/content`：MySQL/Oracle/GaussDB/OS 的报告内容构造；`reporter/renderer`：Markdown 预览、DOCX 模板渲染、表格宽度、风险颜色等；`reporter/internal/web`：Go Web API、任务队列、WebSocket、上传/解压/下载。
- `rules/mysql/rule.json`、`rules/oracle/rule.json`、`rules/gaussdb/rule.json` 以及 AWR/WDR 扩展规则承载可配置检查项。

## 3. 本地启动、Linux / Docker 部署方式

### 本地编译与采集

- 客户侧采集器用 `make build` 编译，输出到 `bin/`；执行 `./bin/db-collector --db-type ... --db-host ...` 生成 `runs/<run_id>/`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L51-L66)，[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L68-L104)
- 源码运行需要 Go、Python、已激活 `.venv`；采集端可 `go run ./collector/cmd/db-collector ...`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L167-L197)
- `Makefile` 中 `build-collector` 会先构建嵌入式 OS helper，再 `go build -o bin/db-collector ./collector/cmd/db-collector`；`build-db-web` 会 `go build -o bin/db-web ./reporter/cmd/db-web`。[`Makefile`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/Makefile#L32-L36)，[`Makefile`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/Makefile#L63-L66)

### Web 服务本地启动

- 推荐用 PM2 同时管理 `dbcheck-api` 后端和 `dbcheck-web` 前端。dev 模式执行 `make pm2-start`；production 模式先 `make build-db-web && make web-build`，再 `make pm2-start-prod`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L220-L264)
- 手动启动后端需要 `DBCHECK_DATA_DIR`、`ALLOWED_ORIGINS`、可选 `DBCHECK_API_TOKEN`，命令为 `go run ./reporter/cmd/db-web --addr 127.0.0.1:8080 --python-bin "$VIRTUAL_ENV/bin/python3"`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L306-L330)
- 手动启动前端：`cd web && npm install && NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080 npm run dev`，访问 `http://127.0.0.1:3000`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L332-L346)

### Linux 部署

- README 给出远程 Linux 示例：在 `.env` 设置 `DBCHECK_ADDR=0.0.0.0:18080`、`DBCHECK_DATA_DIR=/tmp/dbcheck-data`、`ALLOWED_ORIGINS=*`、`DBCHECK_API_TOKEN=ATI`，然后 `make pm2-restart`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L270-L283)
- `ecosystem.config.cjs` 会读取仓库根目录 `.env`，为后端默认设置 `DBCHECK_ADDR=127.0.0.1:8080`、`DBCHECK_DATA_DIR=/tmp/dbcheck-data`、`ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`、`DBCHECK_API_TOKEN=ATI`、`DBCHECK_PYTHON_BIN=.venv/bin/python3`；前端默认端口 `3000`，并可从 `DBCHECK_ADDR` 推导 API 端口。[`ecosystem.config.cjs`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/ecosystem.config.cjs#L50-L111)

### Docker

- 仓库 README 没有给出 Docker 化部署 Web 服务的 Dockerfile/docker-compose 方式；Docker 主要用于 MySQL/Oracle 多版本 e2e 验证，而不是正式部署入口。README 明确 “当前 Docker e2e 覆盖” MySQL `5.6/5.7/8.0`、Oracle `11g/19c`，GaussDB 不承诺 Docker e2e。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L427-L443)
- e2e 入口是 `tests/e2e/run_docker_e2e.sh`，Makefile 通过 `make test-e2e` 调用它。[`Makefile`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/Makefile#L46-L48)

## 4. 是否无状态 / 是否有数据库

- **业务数据层面没有外部数据库依赖**：仓库没有看到服务端数据库 schema/migration 配置；任务状态和上传/输出均落在文件系统 `DBCHECK_DATA_DIR` 下。
- `TaskStore` 在 `dataDir/tasks/<task_id>/task.json` 创建、读取、更新任务状态，使用 JSON 文件原子写入。[`reporter/internal/web/task_store.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/task_store.go#L17-L29)，[`reporter/internal/web/task_store.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/task_store.go#L31-L50)，[`reporter/internal/web/task_store.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/task_store.go#L125-L162)
- Web API 在内存中有工作队列、WebSocket hub 和进程内 worker；`newAPIHandler` 创建 `queue chan queuedTask` 并在启动时 `startWorker()`，因此**不是严格无状态服务**：重启可从文件系统恢复任务元数据，但运行中的队列、WS 连接、进程执行状态属于进程内状态。[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L18-L57)
- 结论：`db-check` **无外部业务数据库**，但 **依赖本地文件系统持久化和进程内队列**。若横向扩容，需要共享文件系统、任务调度/锁、WS 路由等额外设计。

## 5. 检查脚本、日志数据格式、解析/规则、Markdown 预览、DOCX 导出实现

### 5.1 检查脚本 / 采集实现

- 正式采集入口是 Go 二进制 `db-collector`；README 称它是“客户侧唯一可执行采集器”，负责采集数据库与可选 OS 指标，产出标准 `run` 目录。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L4-L7)
- MySQL/Oracle/GaussDB 分别通过 Go 驱动直连数据库采集；GaussDB 已转为 SQL-first，原始 SQL 与结果保留在 `run_dir/sql/`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L138-L142)，[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L157-L163)
- OS 指标只有在显式提供 `--local`、`--os-only` 或远程 OS 参数时采集；远程 OS 采集通过 SSH 下发临时 `db-osprobe` helper，避免依赖目标机预装 `sar/free/vmstat/iostat`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L13-L16)，[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L20-L25)，[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L104-L120)

### 5.2 日志与数据格式

- 每次采集生成 `runs/<run_id>/`，命名为 `<db_type>-<host>-<yyyymmddThhmmssZ>`，典型包含 `collector.log`、`manifest.json`、`result.json`、GaussDB 的 `sql/`。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L444-L466)
- `manifest.json` schema 要求 `schema_version=1.0`、`run_id`、`db_type`、`start_time`、`end_time`、`exit_code`、`overall_status`、`module_stats`、`artifacts`；`db_type` 只允许 `mysql/oracle/gaussdb`；`exit_code` 只允许 `0/10/20/30`。[`contracts/schemas/manifest.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/manifest.schema.json#L5-L27)
- `result.json` schema 要求顶层 `meta`、`collect_config`、`collect_window`、`os`、`db`；`meta.schema_version=2.0`，包含数据库类型、host、port、timezone、collect_time 等。[`contracts/schemas/result.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/result.schema.json#L5-L30)
- `summary.json` schema 要求 `overall_risk`、`counts`、`abnormal_items`、`unevaluated_items`、`na_items`，风险等级为 `low/medium/high`。[`contracts/schemas/summary.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/summary.schema.json#L5-L22)
- WebSocket 日志/进度消息是 JSON：log 消息含 `type/timestamp/level/message`，progress 含 `type/completed/total/current_file`，done 含 `download_url`，error 含 `message`。[`reporter/internal/web/ws_messages.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/ws_messages.go#L2-L24)
- 后端执行 Python pipeline 时同时读取 stdout/stderr，逐行转成 `LogEvent{Stream, Line}` 推送。[`reporter/internal/web/process_runner.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/process_runner.go#L17-L24)，[`reporter/internal/web/process_runner.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/process_runner.go#L34-L95)

### 5.3 解析与规则实现

- rule schema 以 `rule_meta + dimensions[] + checks[]` 组织；每个 check 至少有 `check_id/name/priority/extract`，`extract` 指定 `json_path` 和聚合方式，评估方式支持 `threshold/exists/row_count/info/gate/custom`。[`contracts/schemas/rule.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/rule.schema.json#L5-L22)，[`contracts/schemas/rule.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/rule.schema.json#L52-L143)
- analyzer 从规则收集 checks，根据 `extract.json_path` 从 `result.json` 抽取数据，结合模块状态、NA/gate 逻辑、阈值评估生成 abnormal/unevaluated/na 列表，并按 critical/warning 计算 overall risk。[`analyzer/evaluator/rule_engine.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/rule_engine.py#L29-L60)，[`analyzer/evaluator/rule_engine.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/rule_engine.py#L126-L159)，[`analyzer/evaluator/rule_engine.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/rule_engine.py#L230-L241)
- JSON path 是轻量自研实现：按 `.` 分段，支持 `[*]` 通配数组；聚合支持 `raw/avg/max/min/last/p95/count/sum`；阈值比较支持 `> >= < <= == !=`。[`analyzer/evaluator/path_eval.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/path_eval.py#L27-L48)，[`analyzer/evaluator/path_eval.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/path_eval.py#L57-L108)，[`analyzer/evaluator/path_eval.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/path_eval.py#L143-L188)
- Orchestrator 对 AWR/WDR 做扩展：Oracle AWR 或 GaussDB WDR 会先 enrich result，再把扩展 rule 与基础 rule 合并为 effective rule。[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L103-L123)

### 5.4 Markdown 预览

- Markdown 预览不是前端直接解析 Word，而是 Python reporter 将 `ReportView` 渲染为 Markdown：标题、生成时间、分级章节、段落、表格、字段说明、状态引用。[`reporter/renderer/markdown_preview.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/markdown_preview.py#L10-L27)，[`reporter/renderer/markdown_preview.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/markdown_preview.py#L30-L67)
- Orchestrator 可通过 `--out-md` 生成 Markdown；`report-view` 阶段同时输出 `report-view.json`，可选输出 Markdown。[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L67-L69)，[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L249-L258)

### 5.5 DOCX 导出

- DOCX 导出使用 `python-docx`，入口 `render_template_docx(template_path, report_view_path, output_path)`：加载模板、读取 `report-view.json`、清理模板正文、递归渲染章节/段落/表格，最后保存 DOCX。[`reporter/renderer/template_docx_renderer.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/template_docx_renderer.py#L9-L16)，[`reporter/renderer/template_docx_renderer.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/template_docx_renderer.py#L33-L41)
- 渲染细节包括：标题映射到 Word Heading 样式，引用块用于状态/说明，表格使用 `Table Grid`、固定宽度、表头底色、风险等级列加粗着色、字段说明输出为引用。[`reporter/renderer/template_docx_renderer.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/template_docx_renderer.py#L115-L145)，[`reporter/renderer/template_docx_renderer.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/template_docx_renderer.py#L147-L212)
- 总 pipeline 顺序是：`analyze` 生成 `summary.json` → `meta` 生成 `report-meta.json` → `report-view` 生成 `report-view.json`/可选 MD → `docx` 生成 `report.docx` → validate 校验契约。[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L206-L221)，[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L279-L293)

### 5.6 Web 上传、进度和下载

- Web 生成接口接收 multipart：`zips` 或 `zip` 字段为采集包；Oracle 可按 `awr_<index>` 上传一个 AWR HTML；GaussDB 可按 `wdr_<index>` 上传多个 WDR HTML。[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L118-L135)，[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L161-L220)
- Pipeline 解压 ZIP，检测 run 目录与 db_type，校验 AWR/WDR 适配，调用 Python orchestrator，成功后得到 `report.docx`。[`reporter/internal/web/pipeline.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/pipeline.go#L72-L123)，[`reporter/internal/web/pipeline.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/pipeline.go#L125-L147)
- 前端上传逻辑会先探测 `/api/reports/status/frontend-probe`，然后用 FormData 上传 zips 与 AWR/WDR 文件，下载时按后端返回的 `download_url` 获取 Blob。[`web/src/lib/report-api.ts`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/src/lib/report-api.ts#L34-L56)，[`web/src/lib/report-api.ts`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/src/lib/report-api.ts#L58-L94)，[`web/src/lib/report-api.ts`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/web/src/lib/report-api.ts#L96-L110)

## 6. 对 Tomcat 中间件巡检 MVP：可沿用与不应照搬

### 建议沿用

1. **run 目录 + 契约文件模式**：`manifest.json/result.json/summary.json/report-view.json/report.docx` 的分层很清楚，适合 Tomcat MVP 复用为 `middleware_type=tomcat` 的采集产物。`db-check` 已明确 run 目录结构与 manifest/result/summary schema。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L444-L466)，[`contracts/schemas/result.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/result.schema.json#L5-L30)
2. **采集、分析、报告三段式 pipeline**：采集只产原始结构化结果，analyzer 按规则生成 summary，reporter 从统一 ReportView 渲染 MD/DOCX。这个边界适合 Tomcat：采集 server.xml、JVM 参数、端口、线程池、连接器、日志摘要等；规则层负责阈值/缺失/风险；报告层只做表达。[`reporter/cli/reporter_orchestrator.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/cli/reporter_orchestrator.py#L206-L221)
3. **轻量规则 DSL**：`json_path + aggregation + evaluation` 足够支撑 Tomcat MVP 的大部分规则，例如端口暴露、AJP 是否启用、JVM Xmx/Xms、线程池 maxThreads、access log 是否开启、管理端口/默认应用风险等。[`contracts/schemas/rule.schema.json`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/contracts/schemas/rule.schema.json#L67-L113)，[`analyzer/evaluator/path_eval.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/path_eval.py#L82-L108)
4. **Web 上传 ZIP + 后台任务 + WS 日志/进度 + 下载 ZIP**：对现场巡检回传 ZIP 后统一生成报告的体验可直接复用；后端接口和前端 FormData 模式已经形成稳定链路。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L210-L212)，[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L97-L230)
5. **DOCX 模板渲染方法**：`ReportView -> Markdown/DOCX` 的双输出对 Tomcat 报告同样适用，可复用章节、表格、字段说明、风险颜色、模板占位策略。[`reporter/renderer/markdown_preview.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/markdown_preview.py#L10-L67)，[`reporter/renderer/template_docx_renderer.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/renderer/template_docx_renderer.py#L147-L212)
6. **本地文件持久化优先**：MVP 阶段没有必要引入数据库；`DBCHECK_DATA_DIR/tasks/<task_id>/task.json` 这类结构足够做单机任务管理。[`reporter/internal/web/task_store.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/task_store.go#L17-L29)

### 不应照搬

1. **不要照搬数据库领域模型和目录命名**：Tomcat 不是 DB，建议抽象成 `middleware-check` 或 `tomcat-check`，契约字段用 `target_type=tomcat`、`runtime`、`config`、`jvm`、`connectors`、`apps`、`logs` 等，而不是继续扩展 `db_type/db_host/db_port/db` 字段。
2. **不要照搬 Go+Python+Next 的完整复杂度作为第一版**：如果 Tomcat MVP 只需上传 ZIP 生成报告，可先保留 Python analyzer/reporter 与轻量 Web；如果还要远程采集，再引入 Go helper。`db-check` 的多语言链路适合数据库巡检的长期产品，但对 Tomcat MVP 可能偏重。
3. **不要照搬数据库驱动式采集**：Tomcat 巡检重点是配置文件、进程参数、JMX/HTTP 管理端点、日志解析、文件权限等，不应模拟 MySQL/Oracle/GaussDB 驱动直连采集结构。
4. **不要照搬现有 JSON path 实现的限制**：当前 path 只支持点号与 `[*]`，不支持过滤、条件、XML/属性选择。Tomcat 的 `server.xml/context.xml/web.xml` 需要 XML 解析后的结构化模型，规则层最好对 XML 属性、XPath 映射或预归一化字段有明确设计。[`analyzer/evaluator/path_eval.py`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/analyzer/evaluator/path_eval.py#L57-L79)
5. **不要照搬单机任务队列用于生产多实例**：db-check 当前队列与 WS hub 在进程内，适合单机部署；Tomcat MVP 若要多实例/容器化，需引入外部队列或至少明确单实例部署约束。[`reporter/internal/web/http_handler.go`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/reporter/internal/web/http_handler.go#L18-L57)
6. **不要照搬 AWR/WDR 附件机制**：Tomcat 可借鉴“可选外部附件 enrich result”的模式，但附件类型应换成 GC log、thread dump、heap histogram、access log/error log 摘要等，不应保留 AWR/WDR 命名与数据库绑定校验。
7. **不要把 `ALLOWED_ORIGINS=*`、默认 token `ATI` 当生产配置**：README 明确 `*` 仅建议本地联调临时使用，生产应收紧白名单；Tomcat MVP 也应从一开始把 token/CORS 作为部署配置项。[`README.md`](https://github.com/liumingjian/db-check/blob/337664c18de63276dbfa21442583c345b7d87751/README.md#L306-L317)

## 7. 面向 Tomcat MVP 的落地建议

- 第一版契约：`manifest.json` 保留 `run_id/start_time/end_time/exit_code/module_stats/artifacts`；`result.json` 改为 `meta.target_type=tomcat`，顶层包含 `os`、`tomcat`，其中 `tomcat` 下分 `version`、`install_layout`、`process`、`jvm`、`connectors`、`thread_pools`、`security`、`apps`、`logs`。
- 第一版规则：沿用 `dimensions/checks/extract/evaluation/thresholds`，但先把 XML、properties、shell 输出、日志统计全部预解析成 JSON，再让规则引擎只处理 JSON。
- 第一版报告：复用 `ReportView` 思路，章节建议为“巡检总结、基础信息、JVM 与资源、连接器与线程池、安全配置、应用部署、日志与异常、优化建议”。
- 第一版部署：单机文件持久化 + 后台任务即可；文档明确不支持多实例并发共享。Docker 可作为后续部署补齐项，而不是照搬 db-check 当前 PM2 优先模式。
