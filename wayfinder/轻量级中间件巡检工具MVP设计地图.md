---
type: wayfinder-map
label: wayfinder:map
status: open
tracker: github
canonical: https://github.com/liumingjian/middleware-inspection-tool/issues/1
---

# 轻量级中间件巡检工具 MVP 设计地图

## Destination

形成一份可直接进入实现规划的独立项目设计规格：以 Tomcat 为首个端到端 MVP，完整定义只读 Shell 采集、标准 JSON 契约、内置规则分析、Markdown 编辑预览和 DOCX 导出，并明确 Web 模块边界与验收标准。

地图完成的标准是：Tomcat MVP 在编码前不再存在产品、领域、接口或验收层面的未决问题；本地图不负责实现代码。

## Notes

- 项目独立于 `db-check`，但参考其 Go Web API、Python analyzer/reporter、Next.js/React 前端以及契约分层思想。
- 客户环境只能由人员通过 VPN 和堡垒机手工跳转；系统不得建立 SSH 隧道、自动登录或远程执行。
- 目标服务器为 Linux；允许低权用户在临时目录粘贴或下载 Bash 脚本、执行脚本并产生日志；不使用 `sudo`，不改变中间件运行状态。
- 日志通常通过终端复制带回，也允许在报告页面上传日志文件。
- 脚本管理与报告生成是两个独立模块，不建立任务、资产或状态关联。
- 报告生成时由用户显式选择中间件类型；系统不自动识别巡检对象或中间件类型。
- Tomcat 脚本可以在一次执行中采集同一主机上的多个实例；报告生成器按主机 IP与 PID 拆分，一实例一份报告。
- 标准日志是带边界标记的单个 JSON 文档，以结构化指标和最小必要证据为原则。
- 告警规则第一阶段内置且不暴露配置；系统自动判定并生成建议，用户在 Markdown 编辑器中复核和修订。
- DOCX 使用固定内容和基础样式；品牌、Logo、封面及页眉页脚配置不属于第一阶段。
- 不使用业务数据库，不维护客户、资产、任务历史或跨月数据。
- MVP 开发在 macOS 运行；后续可在 Linux 上用脚本或 Docker 部署。公网安全加固不阻塞 MVP。
- 技术调研见 [db-check 架构与 Tomcat MVP 复用调研](../research/db-check-architecture.md)。
- 领域词汇见 [CONTEXT.md](../CONTEXT.md)。

## Decisions so far

<!-- 每关闭一个子票据，在此追加一行结论索引；详细决定只保存在对应票据的 resolution 中。 -->

## Not yet specified

- Nginx、RabbitMQ、RocketMQ、Elasticsearch 各自的采集能力、JSON 契约、规则和报告结构；待 Tomcat MVP 验证通用内核后逐个建立独立地图或票据。
- 正式公网部署前的认证、HTTPS、日志敏感信息处理、限流、临时文件清理、容器加固和多实例部署方案。
- 商业化阶段的品牌模板、Logo、封面、页眉页脚与主题配置。
- 管理员可配置的告警阈值和规则版本管理。
- 任意非标准现场日志的兼容导入。

## Out of scope

- 自动连接 VPN、堡垒机或客户服务器，以及任何 SSH 隧道、远程执行或自动化登录。
- 客户、资产、实例、集群、账号、巡检计划和历史报告管理。
- Windows 目标服务器、PowerShell、容器平台和 Kubernetes 巡检。
- 跨月趋势分析和自动资产拓扑发现。
- 第一阶段同时实现全部中间件组件。
