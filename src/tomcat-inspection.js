import { readFileSync } from 'node:fs';

export const TOMCAT_SCRIPT_VERSION = 'tomcat-readonly-collector/0.1.0';
export const TOMCAT_PROTOCOL_VERSION = 'tomcat-inspection-log/v1';
export const TOMCAT_RULE_VERSION = 'tomcat-rules/0.1.0';
export const LOG_BEGIN = '===TOMCAT_INSPECTION_JSON_BEGIN===';
export const LOG_END = '===TOMCAT_INSPECTION_JSON_END===';

const SCRIPT_PATH = new URL('../scripts/tomcat-readonly-collector.sh', import.meta.url);

export function getTomcatScriptAsset() {
  return {
    middleware: 'tomcat',
    scriptVersion: TOMCAT_SCRIPT_VERSION,
    protocolVersion: TOMCAT_PROTOCOL_VERSION,
    filename: 'tomcat-readonly-collector.sh',
    content: readFileSync(SCRIPT_PATH, 'utf8'),
    copyFeedback: '已复制完整 Tomcat 巡检脚本。',
    downloadFeedback: '已下载 Tomcat 巡检脚本。'
  };
}

export async function generateTomcatMarkdownReport({
  selectedMiddleware,
  pastedLogCarrier,
  uploadedFile,
  generatedAt = new Date().toISOString()
}) {
  if (selectedMiddleware !== 'tomcat') {
    throw new Error('必须显式选择 Tomcat 后才能生成 Tomcat 巡检报告。');
  }

  const carrier = uploadedFile ? uploadedFile.content.toString('utf8') : pastedLogCarrier;
  const document = parseBoundedLog(carrier);
  const reports = document.instances.map((instance) => ({
    instanceId: instance.instanceId,
    markdown: renderMarkdownReport(document, instance, generatedAt)
  }));

  return { reports };
}

function parseBoundedLog(carrier) {
  const text = String(carrier ?? '');
  const beginCount = text.split(LOG_BEGIN).length - 1;
  const endCount = text.split(LOG_END).length - 1;

  if (beginCount !== 1 || endCount !== 1) {
    throw new Error('日志输入载体必须包含且只包含一对 Tomcat 巡检日志边界。');
  }

  const beginIndex = text.indexOf(LOG_BEGIN);
  const endIndex = text.indexOf(LOG_END);
  if (endIndex <= beginIndex) {
    throw new Error('Tomcat 巡检日志边界顺序无效。');
  }

  const jsonText = text.slice(beginIndex + LOG_BEGIN.length, endIndex).trim();
  const document = JSON.parse(jsonText);

  if (document.middleware !== 'tomcat' || document.protocolVersion !== TOMCAT_PROTOCOL_VERSION) {
    throw new Error('日志中间件类型或协议版本与 Tomcat 巡检组件不兼容。');
  }

  return document;
}

function renderMarkdownReport(document, instance, generatedAt) {
  const check = instance.checks.find(({ id }) => id === 'tomcat.http.port.present');
  const conclusion = check?.observedValue ? '正常' : '无法判断';
  const fact = check?.observedValue ? `HTTP 端口：${check.observedValue}` : 'HTTP 端口：未采集';
  const suggestion = check?.observedValue
    ? '已采集到 Tomcat HTTP 端口，保持现有配置审查流程。'
    : '补充采集 Tomcat HTTP 端口后再复核。';

  return `# Tomcat 单实例巡检报告

## 实例身份

- 主机名：${document.host.hostname}
- 主机 IP：${document.host.ip}
- 进程号：${instance.pid}
- CATALINA_BASE：${instance.catalinaBase}

## 版本与时间

- 协议版本：${document.protocolVersion}
- 采集脚本版本：${document.collectorVersion}
- 规则版本：${TOMCAT_RULE_VERSION}
- 采集时间：${document.collectedAt}
- 报告生成时间：${generatedAt}

## 巡检结论

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
| tomcat.http.port.present | ${conclusion} | ${fact} | ${suggestion} |
`;
}
