# Middleware Inspection Tool

一个面向受限客户环境的轻量级中间件巡检工具。项目当前处于产品与架构设计阶段，首个端到端 MVP 聚焦 Tomcat。

## 背景

客户环境通常只能通过 VPN 和堡垒机由人工登录，巡检账号为低权限账号，无法执行写配置、重启服务等操作。该工具不尝试自动连接客户环境，而是提供两项相互独立的能力：

- **脚本管理**：展示、复制和下载经过审核的只读 Shell 巡检脚本。
- **报告生成**：接收脚本产生的标准 JSON 日志，执行校验和内置规则分析，生成可编辑的 Markdown 预览并导出 DOCX。

## 核心原则

- 不建立 SSH 隧道，不自动登录 VPN、堡垒机或客户服务器。
- 巡检脚本在 Linux 目标主机上由低权用户手工执行。
- 不使用 `sudo`，不修改配置，不改变中间件运行状态。
- 采集结果使用带边界标记的单个 JSON 文档。
- 结构化指标用于规则判断，最小必要证据用于人工复核。
- 不维护客户资产、巡检计划或历史报告。
- 用户主动选择中间件类型，系统不自动推断巡检对象。

## Tomcat MVP 流程

```text
脚本管理页面获取固定 Tomcat 巡检脚本
                    ↓
人工通过 VPN 和堡垒机登录目标 Linux 主机
                    ↓
在临时目录执行只读脚本并复制 JSON 输出
                    ↓
报告生成页面选择 Tomcat 并粘贴或上传日志
                    ↓
协议校验、实例拆分、内置规则分析
                    ↓
生成并人工修订 Markdown
                    ↓
每个 Tomcat 实例导出一份 DOCX
```

同一主机存在多个 Tomcat 实例时，采集日志包含多个实例区块，报告生成器以主机 IP 与进程号作为本次采集标识并拆分报告。

## 计划中的技术架构

该项目独立于 [`liumingjian/db-check`](https://github.com/liumingjian/db-check)，参考其契约分层与报告流水线：

- Go：Web API；
- Python：JSON Schema 校验、规则分析、ReportView、Markdown 和 DOCX 渲染；
- Next.js、React、TypeScript：Web 前端；
- Bash：客户环境中的只读采集脚本；
- 文件和临时目录：单次报告生成过程，不引入业务数据库。

更详细的技术调研见 [research/db-check-architecture.md](research/db-check-architecture.md)。

## 当前状态

当前仓库保存 Wayfinder 设计地图，尚未进入产品实现：

- [MVP 设计地图](wayfinder/轻量级中间件巡检工具MVP设计地图.md)
- [领域词汇](CONTEXT.md)
- [设计票据](wayfinder/tickets/)

首批需要解决的两个前沿问题是：

1. 定义 Tomcat MVP 的巡检范围与权限降级能力；
2. 原型验证脚本管理与报告生成的 Web 交互。

Nginx、RabbitMQ、RocketMQ 和 Elasticsearch 将在 Tomcat MVP 验证通用内核后逐个接入。

## 范围外

第一阶段不包括：

- 自动化远程连接和执行；
- 资产、账号、任务和历史报告管理；
- Windows、容器平台和 Kubernetes 目标环境；
- 告警规则后台配置；
- 报告 Logo、封面、页眉页脚和品牌主题配置；
- 正式公网部署所需的认证、HTTPS、限流与安全加固。

## License

尚未选择开源许可证。在许可证确定前，保留所有权利。
