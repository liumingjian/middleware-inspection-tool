---
type: wayfinder-ticket
label: wayfinder:grilling
status: open
assignee: null
parent: 轻量级中间件巡检工具 MVP 设计地图
blocked_by:
  - 定义 Tomcat MVP 的巡检范围与降级能力
  - 定义 Tomcat 标准 JSON 契约与多实例边界
---

# 定义 Tomcat 内置告警规则与结论语义

## Question

每个 Tomcat 检查项如何从 JSON 指标得到正常、警告、异常、未检查或无法判断，阈值依据、风险汇总、证据引用和整改建议如何定义，才能避免把缺失数据判为正常，并使结果可由人工复核？
