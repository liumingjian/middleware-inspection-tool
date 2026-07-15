---
type: wayfinder-ticket
label: wayfinder:prototype
status: open
assignee: null
parent: 轻量级中间件巡检工具 MVP 设计地图
blocked_by:
  - 定义 Tomcat 标准 JSON 契约与多实例边界
---

# 原型验证 Tomcat 只读采集脚本

## Question

在不依赖新增软件、`sudo`、写配置或改变运行状态的条件下，一份固定 Bash 脚本如何自动发现全部可见 Tomcat 实例、可靠生成合法 JSON，并在常见 Linux 发行版、Tomcat/JDK 版本和权限降级场景中保持可复制、可审计和不中断？
