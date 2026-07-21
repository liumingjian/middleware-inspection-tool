import { readFileSync } from 'node:fs';

export const TOMCAT_SCRIPT_VERSION = 'tomcat-readonly-collector/0.1.0';
export const TOMCAT_PROTOCOL_VERSION = 'tomcat-inspection-log/v1';
export const TOMCAT_RULE_VERSION = 'tomcat-rules/0.1.0';
export const LOG_BEGIN = '===TOMCAT_INSPECTION_JSON_BEGIN===';
export const LOG_END = '===TOMCAT_INSPECTION_JSON_END===';

const SCRIPT_PATH = new URL('../scripts/tomcat-readonly-collector.sh', import.meta.url);

export class InspectionLogError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'InspectionLogError';
    this.code = code;
    this.path = path;
  }
}

function rejectLog(code, path, message) {
  throw new InspectionLogError(code, path, message);
}

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
  if (!selectedMiddleware) {
    rejectLog('MIDDLEWARE_REQUIRED', 'selectedMiddleware', '必须显式选择中间件类型。');
  }
  if (selectedMiddleware !== 'tomcat') {
    rejectLog('MIDDLEWARE_UNSUPPORTED', 'selectedMiddleware', '所选中间件类型不受支持。');
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
    rejectLog('BOUNDARY_COUNT_INVALID', 'carrier', '日志输入载体必须包含且只包含一对巡检日志边界。');
  }

  const beginIndex = text.indexOf(LOG_BEGIN);
  const endIndex = text.indexOf(LOG_END);
  if (endIndex <= beginIndex) {
    rejectLog('BOUNDARY_ORDER_INVALID', 'carrier', '巡检日志边界顺序无效。');
  }

  const jsonText = text.slice(beginIndex + LOG_BEGIN.length, endIndex).trim();
  let document;
  try {
    document = JSON.parse(jsonText);
  } catch {
    rejectLog('JSON_INVALID', 'document', '边界内必须是单个有效 JSON 文档。');
  }

  if (!document || Array.isArray(document) || typeof document !== 'object') {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'document', '巡检日志顶层结构无效。');
  }
  if (!Object.hasOwn(document, 'middleware')) {
    rejectLog('MIDDLEWARE_MISSING', 'middleware', '巡检日志缺少中间件声明。');
  }
  if (document.middleware !== 'tomcat') {
    rejectLog('MIDDLEWARE_MISMATCH', 'middleware', '巡检日志中间件声明与所选类型冲突。');
  }
  if (!Object.hasOwn(document, 'protocolVersion')) {
    rejectLog('PROTOCOL_MISSING', 'protocolVersion', '巡检日志缺少协议版本。');
  }
  if (document.protocolVersion !== TOMCAT_PROTOCOL_VERSION) {
    rejectLog('PROTOCOL_UNSUPPORTED', 'protocolVersion', '巡检日志协议版本不受支持。');
  }
  if (typeof document.collectorVersion !== 'string') {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'collectorVersion', '巡检日志顶层结构无效。');
  }
  if (typeof document.collectedAt !== 'string') {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'collectedAt', '巡检日志顶层结构无效。');
  }
  if (!document.host || typeof document.host !== 'object' || Array.isArray(document.host)) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'host', '巡检日志顶层结构无效。');
  }
  if (!Array.isArray(document.instances) || document.instances.length === 0) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'instances', '巡检日志顶层结构无效。');
  }
  for (const instance of document.instances) {
    if (!instance || typeof instance !== 'object' || typeof instance.instanceId !== 'string' || !Array.isArray(instance.checks)) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', 'instances', '巡检日志实例结构无效。');
    }
  }

  return document;
}

function renderMarkdownReport(document, instance, generatedAt) {
  const rows = buildCheckRows(instance);
  const jvmSource = instance.jvmStartup?.source ?? '未采集';
  const jvmTrust = instance.jvmStartup?.trusted ? '可信' : '不可信';
  const jvmArgs = Array.isArray(instance.jvmStartup?.args) && instance.jvmStartup.args.length > 0
    ? instance.jvmStartup.args.join(' ')
    : '未采集';

  return `# Tomcat 单实例巡检报告

## 实例身份

- 主机名：${document.host.hostname}
- 主机 IP：${document.host.ip}
- 进程号：${instance.pid}
- CATALINA_BASE：${instance.catalinaBase}
- Tomcat 版本：${instance.tomcatVersion ?? '未采集'}
- Java 版本：${instance.javaVersion ?? '未采集'}

## 版本与时间

- 协议版本：${document.protocolVersion}
- 采集脚本版本：${document.collectorVersion}
- 规则版本：${TOMCAT_RULE_VERSION}
- 采集时间：${document.collectedAt}
- 报告生成时间：${generatedAt}

## JVM 启动配置

- 启动参数来源：${jvmSource}（${jvmTrust}）
- JVM 参数：${jvmArgs}

## 巡检结论

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.map(({ id, conclusion, fact, suggestion }) => `| ${id} | ${conclusion} | ${fact} | ${suggestion} |`).join('\n')}
`;
}

function buildCheckRows(instance) {
  const supportedLine = getSupportedTomcatLine(instance.tomcatVersion);
  return [
    {
      id: 'tomcat.instance.identity.present',
      conclusion: instance.instanceId && instance.pid && instance.catalinaBase ? '正常' : '无法判断',
      fact: instance.instanceId ? `实例标识：${instance.instanceId}` : '实例标识：未采集',
      suggestion: instance.instanceId && instance.pid && instance.catalinaBase
        ? '已采集实例身份，按本次采集主机与进程号区分报告。'
        : '补充实例进程号与 CATALINA_BASE 后人工核查。'
    },
    {
      id: 'tomcat.version.support',
      conclusion: supportedLine ? '正常' : '警告',
      fact: supportedLine
        ? `Tomcat 版本：${instance.tomcatVersion}（支持 Tomcat ${supportedLine}）`
        : `Tomcat 版本：${instance.tomcatVersion ?? '未采集'}（不支持版本）`,
      suggestion: supportedLine
        ? '当前版本在 Tomcat MVP 支持范围内。'
        : 'Tomcat MVP 仅明确支持 8.5、9.0 和 10.1；不支持版本需人工确认适用规则。'
    },
    {
      id: 'tomcat.java.version.present',
      conclusion: instance.javaVersion ? '正常' : '无法判断',
      fact: instance.javaVersion ? `Java 版本：${instance.javaVersion}` : 'Java 版本：未采集',
      suggestion: instance.javaVersion
        ? '已采集 Java 版本，结合 Tomcat 版本继续复核兼容性。'
        : '补充 Java 版本后人工核查。'
    },
    jvmRow(instance, 'tomcat.jvm.xms.present', 'xms', '-Xms', 'JVM 初始堆参数，按容量规划复核。'),
    jvmRow(instance, 'tomcat.jvm.xmx.present', 'xmx', '-Xmx', 'JVM 最大堆参数，按容量规划复核。'),
    jvmRow(instance, 'tomcat.jvm.gc.present', 'gc', 'GC', 'GC 选择参数，结合 Java 版本复核。'),
    jvmRow(instance, 'tomcat.jvm.gc-log.present', 'gcLog', 'GC 日志', 'GC 日志配置，确认日志路径可写且纳入运维留存。'),
    httpPortRow(instance)
  ];
}

function getSupportedTomcatLine(version) {
  if (typeof version !== 'string') return null;
  if (version.startsWith('8.5.')) return '8.5';
  if (version.startsWith('9.0.')) return '9.0';
  if (version.startsWith('10.1.')) return '10.1';
  return null;
}

function jvmRow(instance, id, field, label, normalSuggestion) {
  const trusted = instance.jvmStartup?.trusted === true;
  const value = instance.jvmStartup?.[field];
  if (trusted && value) {
    return {
      id,
      conclusion: '正常',
      fact: `${label}：${value}`,
      suggestion: `已采集 ${normalSuggestion}`
    };
  }
  return {
    id,
    conclusion: '无法判断',
    fact: `${label}：未采集`,
    suggestion: '补充可信 JVM 启动参数来源后人工核查。'
  };
}

function httpPortRow(instance) {
  const check = instance.checks.find(({ id }) => id === 'tomcat.http.port.present');
  const conclusion = check?.observedValue ? '正常' : '无法判断';
  const fact = check?.observedValue ? `HTTP 端口：${check.observedValue}` : 'HTTP 端口：未采集';
  const suggestion = check?.observedValue
    ? '已采集到 Tomcat HTTP 端口，保持现有配置审查流程。'
    : '补充采集 Tomcat HTTP 端口后再复核。';

  return { id: 'tomcat.http.port.present', conclusion, fact, suggestion };
}
