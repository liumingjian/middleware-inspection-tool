---
type: wayfinder-ticket
label: wayfinder:grilling
status: open
assignee: null
parent: 轻量级中间件巡检工具 MVP 设计地图
blocked_by:
  - 定义 Tomcat MVP 的巡检范围与降级能力
---

# 定义 Tomcat 标准 JSON 契约与多实例边界

## Question

标准日志的边界标记、版本字段、主机字段、实例数组、检查状态、指标单位、最小证据、采集问题和完整性校验应如何定义，才能稳定承载一台主机多个 Tomcat 实例，并对终端噪声、复制截断和协议不兼容给出确定行为？
