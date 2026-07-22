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
  const discovery = document.discovery;
  const discoveryComplete = discovery.every(({ status }) => status === 'success');
  const reports = [];
  const invalidInstances = [];
  const validInstanceIds = new Set();
  document.instances.forEach((instance, index) => {
    const reasons = validateInstance(instance, index);
    if (reasons.length === 0 && validInstanceIds.has(instance.instanceId)) {
      reasons.push({
        path: `instances[${index}].instanceId`,
        code: 'INSTANCE_ID_DUPLICATE',
        message: '实例标识在本次采集中必须唯一。'
      });
    }
    if (reasons.length > 0) {
      invalidInstances.push({ index, instanceId: instance?.instanceId ?? null, reasons });
      return;
    }
    validInstanceIds.add(instance.instanceId);
    const hostResourceChecks = buildHostResourceChecks(document.host.resources);
    const connectorChecks = buildConnectorChecks(instance.connectors, document.host.cpuCount);
    const securityChecks = buildSecurityChecks(instance.securityConfig);
    const deploymentChecks = buildDeploymentChecks(instance.deployments);
    const logChecks = buildLogChecks(instance.logTargets);
    const checkRows = [...buildCheckRows(instance), ...hostResourceChecks, ...connectorChecks, ...securityChecks, ...deploymentChecks, ...logChecks];
    reports.push({
      instanceId: instance.instanceId,
      discoveryComplete,
      limitations: discoveryComplete ? [] : ['实例发现途径受限或不可用，实例清单可能不完整。'],
      hostResourceChecks,
      connectorChecks,
      securityChecks,
      deploymentChecks,
      logChecks,
      conclusionSummary: summarizeConclusions(checkRows),
      markdown: renderMarkdownReport(document, instance, generatedAt, discoveryComplete, checkRows)
    });
  });

  const noVisibleInstances = document.instances.length === 0;
  const status = noVisibleInstances
    ? 'no_visible_instances'
    : invalidInstances.length === 0
      ? 'success'
      : reports.length > 0
        ? 'partial_success'
        : 'failed';

  return {
    status,
    reports,
    invalidInstances,
    discovery,
    discoveryComplete,
    manualReviewAdvice: reports.length === 0
      ? noVisibleInstances
        ? '当前低权用户未发现可见 Tomcat 实例，这不代表主机不存在 Tomcat。请结合发现途径状态人工核查。'
        : '未发现有效 Tomcat 实例。请结合发现途径状态人工核查主机上的 Tomcat 进程。'
      : null
  };
}

function validateInstance(instance, index) {
  const reasons = [];
  const path = `instances[${index}]`;
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    return [{ path, code: 'INSTANCE_INVALID', message: '实例结构无效。' }];
  }
  if (typeof instance.instanceId !== 'string' || !instance.instanceId) {
    reasons.push({ path: `${path}.instanceId`, code: 'INSTANCE_ID_INVALID', message: '实例标识不能为空。' });
  }
  if (!Number.isInteger(instance.pid) || instance.pid <= 0) {
    reasons.push({ path: `${path}.pid`, code: 'INSTANCE_PID_INVALID', message: '实例进程号必须是正整数。' });
  }
  if (typeof instance.catalinaBase !== 'string' || !instance.catalinaBase) {
    reasons.push({ path: `${path}.catalinaBase`, code: 'INSTANCE_CATALINA_BASE_INVALID', message: '实例 CATALINA_BASE 不能为空。' });
  }
  if (!Array.isArray(instance.checks)) {
    reasons.push({ path: `${path}.checks`, code: 'INSTANCE_CHECKS_INVALID', message: '实例巡检项必须是数组。' });
  }
  validateConnectors(instance.connectors, path);
  validateSecurityConfig(instance.securityConfig, path);
  validateDeployments(instance.deployments, path);
  validateLogTargets(instance.logTargets, path);
  return reasons;
}

function validateLogTargets(targets, instancePath) {
  if (targets === undefined) return;
  if (!Array.isArray(targets)) rejectLog('DOCUMENT_SCHEMA_INVALID', `${instancePath}.logTargets`, '日志配置与文件状态事实结构无效。');
  const statuses = ['success', 'restricted', 'unavailable', 'unreliable'];
  const targetIds = new Set();
  targets.forEach((target, index) => {
    const path = `${instancePath}.logTargets[${index}]`;
    if (!target || typeof target !== 'object' || Array.isArray(target)
      || typeof target.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id)
      || !target.configuration || typeof target.configuration !== 'object' || Array.isArray(target.configuration)
      || !statuses.includes(target.configuration.status)
      || typeof target.configuration.source !== 'string' || !target.configuration.source
      || !target.fileMetadata || typeof target.fileMetadata !== 'object' || Array.isArray(target.fileMetadata)
      || !statuses.includes(target.fileMetadata.status)
      || typeof target.fileMetadata.source !== 'string' || !target.fileMetadata.source) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, '日志配置与文件状态事实结构无效。');
    }
    if (targetIds.has(target.id)) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', `${path}.id`, '日志配置与文件状态事实标识必须稳定且唯一。');
    }
    targetIds.add(target.id);
    const configurationKeys = target.configuration.status === 'success' ? ['status', 'source', 'targetPath'] : ['status', 'source'];
    if (Object.keys(target.configuration).some((key) => !configurationKeys.includes(key))
      || (target.configuration.status === 'success' && (typeof target.configuration.targetPath !== 'string' || !target.configuration.targetPath))) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', `${path}.configuration`, '日志配置证据必须有界且可定位。');
    }
    const metadataKeys = target.fileMetadata.status === 'success'
      ? ['status', 'source', 'fileType', 'sizeBytes', 'modifiedAt']
      : ['status', 'source'];
    if (Object.keys(target.fileMetadata).some((key) => !metadataKeys.includes(key))
      || (target.fileMetadata.status === 'success' && (typeof target.fileMetadata.fileType !== 'string' || !target.fileMetadata.fileType
        || !Number.isInteger(target.fileMetadata.sizeBytes) || target.fileMetadata.sizeBytes < 0
        || typeof target.fileMetadata.modifiedAt !== 'string' || !target.fileMetadata.modifiedAt))) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', `${path}.fileMetadata`, '日志文件元数据证据无效。');
    }
  });
}

function validateDeployments(deployments, instancePath) {
  if (deployments === undefined) return;
  if (!Array.isArray(deployments)) rejectLog('DOCUMENT_SCHEMA_INVALID', `${instancePath}.deployments`, '应用部署事实结构无效。');
  const deploymentTypes = ['exploded-directory', 'war', 'external-directory', 'external-war'];
  deployments.forEach((deployment, index) => {
    const path = `${instancePath}.deployments[${index}]`;
    if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)
      || !['success', 'restricted', 'unavailable', 'unreliable'].includes(deployment.status)
      || typeof deployment.source !== 'string' || !deployment.source) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, '应用部署事实结构无效。');
    }
    if (deployment.status !== 'success') return;
    const config = deployment.containerConfig;
    if (typeof deployment.applicationName !== 'string' || !deployment.applicationName
      || typeof deployment.deploymentPath !== 'string' || !deployment.deploymentPath
      || !deploymentTypes.includes(deployment.deploymentType)
      || !config || typeof config !== 'object' || Array.isArray(config)
      || typeof config.contextPath !== 'string'
      || typeof config.reloadable !== 'boolean' || typeof config.deployOnStartup !== 'boolean' || typeof config.unpackWARs !== 'boolean') {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, '应用部署事实结构无效。');
    }
  });
}

function validateSecurityConfig(config, instancePath) {
  if (config === undefined) return;
  const path = `${instancePath}.securityConfig`;
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !['success', 'restricted', 'unavailable', 'unreliable'].includes(config.status)
    || config.source !== 'local-static-config') {
    rejectLog('DOCUMENT_SCHEMA_INVALID', path, 'Tomcat 静态安全配置事实无效。');
  }
  if (config.status !== 'success') return;
  const booleanFacts = ['directoryListingEnabled', 'autoDeployEnabled', 'serverInfoExposed', 'tlsConnectorPresent'];
  if (booleanFacts.some((name) => typeof config[name] !== 'boolean')
    || !Number.isInteger(config.shutdownPort) || config.shutdownPort < -1 || config.shutdownPort > 65535) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', path, 'Tomcat 静态安全配置事实无效。');
  }
}

function validateConnectors(connectors, instancePath) {
  if (connectors === undefined) return;
  if (!Array.isArray(connectors)) rejectLog('DOCUMENT_SCHEMA_INVALID', `${instancePath}.connectors`, 'Connector 事实结构无效。');
  const sources = ['explicit', 'version-default', 'reference', 'unresolved'];
  const factNames = ['port', 'maxThreads', 'acceptCount', 'connectionTimeout'];
  connectors.forEach((connector, index) => {
    const path = `${instancePath}.connectors[${index}]`;
    if (!connector || typeof connector !== 'object' || !['success', 'restricted', 'unavailable', 'unreliable'].includes(connector.status)
      || typeof connector.evidence !== 'string' || !connector.evidence) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, 'Connector 事实结构无效。');
    }
    if (connector.status !== 'success') return;
    if (typeof connector.protocolHandler !== 'string' || !connector.protocolHandler || typeof connector.executor !== 'string') {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, 'Connector 事实结构无效。');
    }
    for (const name of factNames) {
      const fact = connector[name];
      if (!fact || typeof fact !== 'object' || !sources.includes(fact.source)
        || (fact.source === 'unresolved' ? Object.hasOwn(fact, 'value') : !Number.isInteger(fact.value) || fact.value < 0)) {
        rejectLog('DOCUMENT_SCHEMA_INVALID', `${path}.${name}`, 'Connector 有效值及来源无效。');
      }
    }
  });
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
  validateHostResources(document.host);
  if (document.host.cpuCount !== undefined && (!Number.isInteger(document.host.cpuCount) || document.host.cpuCount <= 0)) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'host.cpuCount', '主机 CPU 核数事实无效。');
  }
  if (!Array.isArray(document.discovery) || document.discovery.length === 0) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'discovery', '巡检日志实例发现结果无效。');
  }
  for (const [index, discovery] of document.discovery.entries()) {
    if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)
      || typeof discovery.method !== 'string' || !discovery.method
      || !['success', 'restricted', 'unavailable'].includes(discovery.status)
      || typeof discovery.detail !== 'string') {
      rejectLog('DOCUMENT_SCHEMA_INVALID', `discovery[${index}]`, '巡检日志实例发现结果无效。');
    }
  }
  if (!Array.isArray(document.instances)) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'instances', '巡检日志顶层结构无效。');
  }

  return document;
}

function validateHostResources(host) {
  if (host.resources === undefined) return;
  if (!host.resources || typeof host.resources !== 'object' || Array.isArray(host.resources)) {
    rejectLog('DOCUMENT_SCHEMA_INVALID', 'host.resources', '主机资源事实结构无效。');
  }
  const units = { disk: 'bytes', inode: 'inodes', memory: 'bytes' };
  for (const [kind, unit] of Object.entries(units)) {
    const fact = host.resources[kind];
    const path = `host.resources.${kind}`;
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)
      || !['success', 'restricted', 'unavailable', 'unreliable'].includes(fact.status)
      || typeof fact.source !== 'string' || !fact.source || fact.unit !== unit) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, '主机资源事实结构无效。');
    }
    if (fact.status === 'success' && (!Number.isFinite(fact.total) || fact.total <= 0
      || !Number.isFinite(fact.available) || fact.available < 0 || fact.available > fact.total
      || !Number.isFinite(fact.usedPercent) || fact.usedPercent < 0 || fact.usedPercent > 100
      || (kind !== 'memory' && (typeof fact.mount !== 'string' || !fact.mount)))) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', path, '主机资源事实结构无效。');
    }
  }
  if (host.observations !== undefined) {
    if (!Array.isArray(host.observations)) {
      rejectLog('DOCUMENT_SCHEMA_INVALID', 'host.observations', '主机资源观察指标结构无效。');
    }
    for (const [index, observation] of host.observations.entries()) {
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)
        || typeof observation.id !== 'string' || !observation.id
        || !['success', 'restricted', 'unavailable', 'unreliable'].includes(observation.status)
        || typeof observation.source !== 'string' || !observation.source
        || typeof observation.unit !== 'string' || !observation.unit
        || (observation.status === 'success' && !Number.isFinite(observation.value))) {
        rejectLog('DOCUMENT_SCHEMA_INVALID', `host.observations[${index}]`, '主机资源观察指标结构无效。');
      }
    }
  }
}

function renderDiscoveryCoverage(discovery, discoveryComplete) {
  if (discovery.length === 0) return '';
  const labels = { success: '成功', restricted: '受限', unavailable: '不可用' };
  const lines = discovery.map(({ method, status, detail }) => `- ${method}：${labels[status] ?? status}（${detail}）`);
  const limitation = discoveryComplete
    ? '所有记录的实例发现途径均成功。'
    : '已发现实例仍可生成报告，但实例清单可能不完整，需人工核查覆盖限制。';
  return `## 实例发现覆盖范围\n\n${lines.join('\n')}\n\n${limitation}\n\n`;
}

function renderMarkdownReport(document, instance, generatedAt, discoveryComplete, rows) {
  const summary = summarizeConclusions(rows);
  const jvmSource = instance.jvmStartup?.source ?? '未采集';
  const jvmTrust = instance.jvmStartup?.trusted ? '可信' : '不可信';
  const jvmArgs = Array.isArray(instance.jvmStartup?.args) && instance.jvmStartup.args.length > 0
    ? instance.jvmStartup.args.join(' ')
    : '未采集';

  const observations = renderHostObservations(document.host.observations ?? []);

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

${renderDiscoveryCoverage(document.discovery ?? [], discoveryComplete)}## JVM 启动配置

- 启动参数来源：${jvmSource}（${jvmTrust}）
- JVM 参数：${jvmArgs}

## 结论摘要

正常：${summary.normal}；警告：${summary.warning}；异常：${summary.abnormal}；无法判断：${summary.unknown}；不适用：${summary.notApplicable}

## 主机资源域

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => domain === 'host-resources').map(({ id, conclusion, evidence, suggestion }) => `| ${id} | ${conclusion} | ${evidence} | ${suggestion} |`).join('\n')}

## Connector 与线程池域

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => domain === 'connector-thread-pool').map(({ id, conclusion, evidence, suggestion }) => `| ${id} | ${conclusion} | ${evidence} | ${suggestion} |`).join('\n') || '| - | 无法判断 | 未采集 Connector 事实 | 补充可读 server.xml 后人工核查。 |'}

## 静态配置安全域

> 本域仅覆盖本地静态配置基线，不执行 CVE 匹配、主动探测或登录尝试，也不构成完整安全评估。

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => domain === 'static-security').map(({ id, conclusion, evidence, suggestion }) => `| ${id} | ${conclusion} | ${evidence} | ${suggestion} |`).join('\n')}

## 应用部署概况域

> 本域仅报告可见的部署清单与容器配置事实，不读取 WAR 内容、不扫描应用配置、不调用业务接口，也不推断应用或集群关系。

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => domain === 'application-deployment').map(({ id, conclusion, evidence, suggestion }) => `| ${id} | ${conclusion} | ${evidence} | ${suggestion} |`).join('\n')}

## 日志配置与文件状态域

> 本域仅检查静态日志配置、输出目标路径和文件元数据，不读取或分析日志正文，不统计错误、不分析异常模式，也不推断故障根因。

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => domain === 'logging-file-status').map(({ id, conclusion, evidence, suggestion }) => `| ${id} | ${conclusion} | ${evidence} | ${suggestion} |`).join('\n')}

${observations}## 巡检结论

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
${rows.filter(({ domain }) => !['host-resources', 'connector-thread-pool', 'static-security', 'application-deployment', 'logging-file-status'].includes(domain)).map(({ id, conclusion, fact, suggestion }) => `| ${id} | ${conclusion} | ${fact} | ${suggestion} |`).join('\n')}
`;
}

function buildLogChecks(targets) {
  if (targets === undefined) return [];
  if (targets.length === 0) {
    return [logCheck('tomcat.logging.configuration', '无法判断', '采集状态：unavailable；来源：static-log-configuration', '补充约定日志配置、目标路径和文件元数据后人工核查。')];
  }
  return targets.flatMap((target) => {
    const configuration = target.configuration;
    const metadata = target.fileMetadata;
    const configurationEvidence = `采集状态：${configuration.status}；来源：${configuration.source}${configuration.status === 'success' ? `；目标路径：${configuration.targetPath}` : ''}`;
    const metadataEvidence = `采集状态：${metadata.status}；来源：${metadata.source}${metadata.status === 'success' ? `；类型：${metadata.fileType}；大小：${metadata.sizeBytes} bytes；修改时间：${metadata.modifiedAt}` : ''}`;
    return [
      logCheck(`tomcat.logging.${target.id}.configuration`, configuration.status === 'success' ? '正常' : '无法判断', configurationEvidence,
        configuration.status === 'success' ? '已记录可定位的静态日志配置与输出目标；保持配置审查。' : '补充可读且可定位的静态日志配置后人工核查。'),
      logCheck(`tomcat.logging.${target.id}.file-status`, metadata.status === 'success' ? '正常' : '无法判断', metadataEvidence,
        metadata.status === 'success' ? '已记录目标文件的有界元数据；结合留存策略人工复核。' : '补充目标路径可访问性和文件元数据后人工核查。')
    ];
  });
}

function logCheck(id, conclusion, evidence, suggestion) {
  return { id, domain: 'logging-file-status', conclusion, evidence, suggestion };
}

function buildDeploymentChecks(deployments) {
  const id = 'tomcat.application.deployment.inventory';
  if (!deployments || deployments.length === 0) {
    return [{
      id,
      domain: 'application-deployment',
      conclusion: '无法判断',
      evidence: '采集状态：unavailable；来源：deployment-inventory；未采集可见应用部署事实',
      suggestion: '补充可读的部署目录与容器上下文配置事实后人工核查；应用部署清单可能不完整。'
    }];
  }

  const evidence = deployments.map((deployment) => {
    if (deployment.status !== 'success') return `采集状态：${deployment.status}；来源：${deployment.source}`;
    const config = deployment.containerConfig;
    return `应用：${deployment.applicationName}；路径：${deployment.deploymentPath}；形态：${deployment.deploymentType}；上下文路径：${config.contextPath || '/'}；reloadable：${config.reloadable}；deployOnStartup：${config.deployOnStartup}；unpackWARs：${config.unpackWARs}；来源：${deployment.source}`;
  }).join('；\n');
  const complete = deployments.every(({ status }) => status === 'success');
  return [{
    id,
    domain: 'application-deployment',
    conclusion: complete ? '正常' : '无法判断',
    evidence,
    suggestion: complete
      ? '已记录巡检复核所需的最小部署与容器配置事实；结合发布记录人工复核。'
      : '补充不可见部署来源的事实后人工核查；应用部署清单可能不完整。'
  }];
}

function buildSecurityChecks(config) {
  if (!config || config.status !== 'success') {
    return [{
      id: 'tomcat.security.configuration',
      domain: 'static-security',
      conclusion: '无法判断',
      evidence: `采集状态：${config?.status ?? 'unavailable'}；来源：${config?.source ?? 'local-static-config'}`,
      suggestion: '补充可读的本地静态安全配置事实后人工核查。'
    }];
  }
  return [
    securityCheck('tomcat.security.directory-listing', config.directoryListingEnabled ? '异常' : '正常', `目录列表：${config.directoryListingEnabled ? '启用' : '关闭'}`,
      config.directoryListingEnabled ? '已证明目录列表启用；先核查应用依赖并通过客户变更流程关闭目录列表。' : '目录列表已关闭，保持静态配置审查。'),
    securityCheck('tomcat.security.auto-deploy', config.autoDeployEnabled ? '警告' : '正常', `自动部署：${config.autoDeployEnabled ? '启用' : '关闭'}`,
      config.autoDeployEnabled ? '自动部署已启用，存在基线偏离风险；核查部署流程后通过客户变更流程评估关闭。' : '自动部署已关闭，保持静态配置审查。'),
    securityCheck('tomcat.security.server-info', config.serverInfoExposed ? '警告' : '正常', `服务端版本信息暴露：${config.serverInfoExposed ? '是' : '否'}`,
      config.serverInfoExposed ? '服务端版本信息可见；核查兼容性后通过客户变更流程减少信息暴露。' : '未发现服务端版本信息暴露。'),
    securityCheck('tomcat.security.shutdown-port', config.shutdownPort === -1 ? '正常' : '警告', `关闭端口：${config.shutdownPort}`,
      config.shutdownPort === -1 ? '关闭端口已禁用。' : '关闭端口已启用；核查运维依赖和访问边界后通过客户变更流程评估禁用。'),
    securityCheck('tomcat.security.tls-connector', '不适用', `TLS Connector：${config.tlsConnectorPresent ? '存在' : '未发现'}`,
      'TLS 是否应在 Tomcat 终止取决于部署拓扑；结合反向代理与网络边界人工核查。')
  ];
}

function securityCheck(id, conclusion, evidence, suggestion) {
  return { id, domain: 'static-security', conclusion, evidence, suggestion };
}

function buildConnectorChecks(connectors, cpuCount) {
  if (!connectors || connectors.length === 0) {
    return [connectorCheck(
      'tomcat.connector.configuration',
      '无法判断',
      'minimum-evidence',
      '采集状态：unavailable；证据：未采集 Connector 配置事实',
      '补充可读且完整的 server.xml 配置事实后人工核查。'
    )];
  }
  if (connectors.some(({ status }) => status !== 'success')) {
    const degraded = connectors.find(({ status }) => status !== 'success');
    return [connectorCheck(
      'tomcat.connector.configuration',
      '无法判断',
      'minimum-evidence',
      `采集状态：${degraded.status}；证据：${degraded.evidence}`,
      '补充可读且完整的 server.xml 配置事实后人工核查。'
    )];
  }
  return connectors.flatMap((connector) => {
    const facts = connectorEvidence(connector);
    const timeout = connector.connectionTimeout;
    const correctness = timeout.source === 'unresolved'
      ? connectorCheck('tomcat.connector.connection-timeout', '无法判断', 'correctness-baseline', facts, '补充 connectionTimeout 有效值后人工核查。')
      : connectorCheck('tomcat.connector.connection-timeout', timeout.value === 0 ? '异常' : '正常', 'correctness-baseline', facts,
        timeout.value === 0 ? '连接超时为无限等待；先核查影响并通过客户变更流程调整为有限值。' : '连接超时已设置有限值，保持配置审查。');
    const maxThreads = connector.maxThreads;
    const capacity = !Number.isInteger(cpuCount) || maxThreads.source === 'unresolved'
      ? connectorCheck('tomcat.thread-pool.host-capacity', '无法判断', 'host-capacity-baseline', facts, '补充 CPU 数量和 maxThreads 有效值后人工核查。')
      : connectorCheck('tomcat.thread-pool.host-capacity', maxThreads.value < cpuCount * 4 ? '警告' : '正常', 'host-capacity-baseline', facts,
        maxThreads.value < cpuCount * 4 ? '线程数低于可由主机 CPU 计算的静态容量基线；先核查影响并通过客户变更流程调整。' : '线程池满足当前主机静态容量基线，继续结合负载验证。');
    const tuning = connectorCheck('tomcat.connector.accept-count', '不适用', 'workload-tuning', facts, 'acceptCount 依赖并发与响应时间；结合业务负载测试调优，不直接执行配置变更。');
    return [correctness, capacity, tuning];
  });
}

function connectorCheck(id, conclusion, semantics, evidence, suggestion) {
  return { id, domain: 'connector-thread-pool', conclusion, semantics, evidence, suggestion };
}

function connectorEvidence(connector) {
  const labels = { explicit: '显式值', 'version-default': 'Tomcat 版本默认值', reference: '静态引用值', unresolved: '无法解析' };
  const fact = (label, value) => `${label}：${value.source === 'unresolved' ? '未解析' : value.value}（${labels[value.source]}）`;
  return [`协议处理器：${connector.protocolHandler}`, fact('端口', connector.port), fact('maxThreads', connector.maxThreads), fact('acceptCount', connector.acceptCount), fact('connectionTimeout', connector.connectionTimeout), `证据：${connector.evidence}`].join('；');
}

function buildHostResourceChecks(resources) {
  if (!resources) {
    return [
      missingResourceCheck('host.disk.capacity', 'df -Pk /opt'),
      missingResourceCheck('host.inode.capacity', 'df -Pi /opt'),
      missingResourceCheck('host.memory.available', '/proc/meminfo:MemAvailable')
    ];
  }
  return [
    capacityCheck(resources.disk, {
      id: 'host.disk.capacity',
      warningAt: 80,
      abnormalAt: 90,
      normalSuggestion: '磁盘可用容量满足当前静态基线，继续结合容量趋势评估。',
      warningSuggestion: '核查磁盘空间消耗来源并规划清理或扩容；变更前完成影响评估、备份并遵循客户变更流程。',
      abnormalSuggestion: '评估并释放磁盘空间或扩容；变更前完成影响评估、备份并遵循客户变更流程。'
    }),
    capacityCheck(resources.inode, {
      id: 'host.inode.capacity',
      warningAt: 80,
      abnormalAt: 90,
      normalSuggestion: 'inode 可用容量满足当前静态基线，继续结合容量趋势评估。',
      warningSuggestion: '核查 inode 消耗来源并规划清理或扩容；变更前完成影响评估、备份并遵循客户变更流程。',
      abnormalSuggestion: '评估并释放 inode 或扩容；变更前完成影响评估、备份并遵循客户变更流程。'
    }),
    memoryCheck(resources.memory)
  ];
}

function capacityCheck(fact, rule) {
  if (fact.status !== 'success') return unknownResourceCheck(fact, rule.id);
  const conclusion = fact.usedPercent >= rule.abnormalAt ? '异常' : fact.usedPercent >= rule.warningAt ? '警告' : '正常';
  const suggestion = conclusion === '异常' ? rule.abnormalSuggestion : conclusion === '警告' ? rule.warningSuggestion : rule.normalSuggestion;
  return {
    id: rule.id,
    domain: 'host-resources',
    conclusion,
    evidence: `挂载点 ${fact.mount}，已用 ${fact.usedPercent}%，可用 ${fact.available} ${fact.unit}（${fact.source}）`,
    suggestion
  };
}

function memoryCheck(fact) {
  const id = 'host.memory.available';
  if (fact.status !== 'success') return unknownResourceCheck(fact, id);
  const availablePercent = Math.round((fact.available / fact.total) * 100);
  const conclusion = availablePercent < 10 ? '异常' : availablePercent < 20 ? '警告' : '正常';
  const suggestions = {
    正常: '可用内存容量满足当前静态基线，继续结合长期监控评估。',
    警告: '核查内存容量与主要使用者并规划扩容；变更前完成影响评估、备份并遵循客户变更流程。',
    异常: '评估内存压力并规划扩容或容量调整；变更前完成影响评估、备份并遵循客户变更流程。'
  };
  return {
    id,
    domain: 'host-resources',
    conclusion,
    evidence: `可用内存 ${fact.available} ${fact.unit}，占总量 ${availablePercent}%（${fact.source}）`,
    suggestion: suggestions[conclusion]
  };
}

function unknownResourceCheck(fact, id) {
  return {
    id,
    domain: 'host-resources',
    conclusion: '无法判断',
    evidence: `采集状态：${fact.status}；来源：${fact.source}`,
    suggestion: '补充满足可靠口径的容量事实后人工核查。'
  };
}

function missingResourceCheck(id, source) {
  return {
    id,
    domain: 'host-resources',
    conclusion: '无法判断',
    evidence: `采集状态：unavailable；来源：${source}`,
    suggestion: '补充满足可靠口径的容量事实后人工核查。'
  };
}

function summarizeConclusions(rows) {
  const keys = { 正常: 'normal', 警告: 'warning', 异常: 'abnormal', 无法判断: 'unknown', 不适用: 'notApplicable' };
  const summary = { normal: 0, warning: 0, abnormal: 0, unknown: 0, notApplicable: 0 };
  for (const { conclusion } of rows) summary[keys[conclusion]] += 1;
  return summary;
}

function renderHostObservations(observations) {
  if (observations.length === 0) return '## 观察指标（不参与结论计数）\n\n无可靠观察指标。\n\n';
  const lines = observations.map(({ id, status, value, unit, source }) => status === 'success'
    ? `- ${id}：${value} ${unit}（${source}）`
    : `- ${id}：采集状态 ${status}（${source}）`);
  return `## 观察指标（不参与结论计数）\n\n${lines.join('\n')}\n\n`;
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
      conclusion: supportedLine ? '正常' : instance.tomcatVersion ? '警告' : '无法判断',
      fact: supportedLine
        ? `Tomcat 版本：${instance.tomcatVersion}（支持 Tomcat ${supportedLine}）`
        : instance.tomcatVersion
          ? `Tomcat 版本：${instance.tomcatVersion}（不支持版本）`
          : 'Tomcat 版本：未采集',
      suggestion: supportedLine
        ? '当前版本在 Tomcat MVP 支持范围内。'
        : instance.tomcatVersion
          ? 'Tomcat MVP 仅明确支持 8.5、9.0 和 10.1；不支持版本需人工确认适用规则。'
          : '补充 Tomcat 版本后人工核查适用规则。'
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
