import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getTomcatScriptAsset, generateTomcatMarkdownReport, LOG_BEGIN, LOG_END } from '../src/tomcat-inspection.js';

const sampleLog = readFileSync(new URL('./fixtures/tomcat-single-instance.log', import.meta.url), 'utf8');

function buildCarrier(instanceOverrides) {
  const document = {
    middleware: 'tomcat',
    protocolVersion: 'tomcat-inspection-log/v1',
    collectorVersion: 'tomcat-readonly-collector/0.1.0',
    collectedAt: '2026-07-21T00:00:00Z',
    host: { hostname: 'demo-host', ip: '192.0.2.10' },
    instances: [
      {
        instanceId: 'demo-host:12345',
        pid: 12345,
        catalinaBase: '/opt/tomcat-demo',
        tomcatVersion: '9.0.85',
        javaVersion: '17.0.10',
        jvmStartup: {
          source: 'TOMCAT_INSPECTOR_JVM_ARGS',
          trusted: true,
          args: ['-Xms512m', '-Xmx1024m', '-XX:+UseG1GC', '-Xlog:gc*:file=/var/log/tomcat/gc.log'],
          xms: '512m',
          xmx: '1024m',
          gc: 'G1GC',
          gcLog: '/var/log/tomcat/gc.log'
        },
        httpPort: 8080,
        checks: [],
        ...instanceOverrides
      }
    ]
  };
  return `${LOG_BEGIN}\n${JSON.stringify(document)}\n${LOG_END}`;
}

test('script management exposes the current Tomcat collector for copy and download', () => {
  const asset = getTomcatScriptAsset();

  assert.equal(asset.middleware, 'tomcat');
  assert.equal(asset.scriptVersion, 'tomcat-readonly-collector/0.1.0');
  assert.equal(asset.protocolVersion, 'tomcat-inspection-log/v1');
  assert.equal(asset.filename, 'tomcat-readonly-collector.sh');
  assert.match(asset.content, /^#!\/usr\/bin\/env bash/);
  assert.match(asset.copyFeedback, /已复制完整 Tomcat 巡检脚本/);
  assert.match(asset.downloadFeedback, /已下载 Tomcat 巡检脚本/);
});

test('report generation application boundary turns a pasted Tomcat log carrier into one Markdown report', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: sampleLog,
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].instanceId, 'demo-host:12345');
  assert.equal(result.reports[0].markdown, `# Tomcat 单实例巡检报告

## 实例身份

- 主机名：demo-host
- 主机 IP：192.0.2.10
- 进程号：12345
- CATALINA_BASE：/opt/tomcat-demo
- Tomcat 版本：9.0.85
- Java 版本：17.0.10

## 版本与时间

- 协议版本：tomcat-inspection-log/v1
- 采集脚本版本：tomcat-readonly-collector/0.1.0
- 规则版本：tomcat-rules/0.1.0
- 采集时间：2026-07-21T00:00:00Z
- 报告生成时间：2026-07-21T01:02:03Z

## JVM 启动配置

- 启动参数来源：TOMCAT_INSPECTOR_JVM_ARGS（可信）
- JVM 参数：-Xms512m -Xmx1024m -XX:+UseG1GC -Xlog:gc*:file=/var/log/tomcat/gc.log

## 巡检结论

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
| tomcat.instance.identity.present | 正常 | 实例标识：demo-host:12345 | 已采集实例身份，按本次采集主机与进程号区分报告。 |
| tomcat.version.support | 正常 | Tomcat 版本：9.0.85（支持 Tomcat 9.0） | 当前版本在 Tomcat MVP 支持范围内。 |
| tomcat.java.version.present | 正常 | Java 版本：17.0.10 | 已采集 Java 版本，结合 Tomcat 版本继续复核兼容性。 |
| tomcat.jvm.xms.present | 正常 | -Xms：512m | 已采集 JVM 初始堆参数，按容量规划复核。 |
| tomcat.jvm.xmx.present | 正常 | -Xmx：1024m | 已采集 JVM 最大堆参数，按容量规划复核。 |
| tomcat.jvm.gc.present | 正常 | GC：G1GC | 已采集 GC 选择参数，结合 Java 版本复核。 |
| tomcat.jvm.gc-log.present | 正常 | GC 日志：/var/log/tomcat/gc.log | 已采集 GC 日志配置，确认日志路径可写且纳入运维留存。 |
| tomcat.http.port.present | 正常 | HTTP 端口：8080 | 已采集到 Tomcat HTTP 端口，保持现有配置审查流程。 |
`);
});

test('report generation marks unsupported Tomcat minor lines instead of treating them as supported', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ tomcatVersion: '7.0.109' }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.match(result.reports[0].markdown, /tomcat\.version\.support \| 警告 \| Tomcat 版本：7\.0\.109（不支持版本）/);
  assert.match(result.reports[0].markdown, /Tomcat MVP 仅明确支持 8\.5、9\.0 和 10\.1/);
});

test('report generation does not classify a missing Tomcat version as unsupported', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ tomcatVersion: '' }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.match(result.reports[0].markdown, /tomcat\.version\.support \| 无法判断 \| Tomcat 版本：未采集/);
  assert.match(result.reports[0].markdown, /补充 Tomcat 版本后人工核查适用规则。/);
});

test('report generation produces per-item unknown conclusions when JVM startup evidence is missing', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({
      jvmStartup: { source: 'ps.args', trusted: false, args: [] }
    }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  const markdown = result.reports[0].markdown;
  assert.match(markdown, /启动参数来源：ps\.args（不可信）/);
  assert.match(markdown, /tomcat\.jvm\.xms\.present \| 无法判断 \| -Xms：未采集 \| 补充可信 JVM 启动参数来源后人工核查。/);
  assert.match(markdown, /tomcat\.jvm\.xmx\.present \| 无法判断 \| -Xmx：未采集 \| 补充可信 JVM 启动参数来源后人工核查。/);
  assert.match(markdown, /tomcat\.jvm\.gc\.present \| 无法判断 \| GC：未采集 \| 补充可信 JVM 启动参数来源后人工核查。/);
  assert.match(markdown, /tomcat\.jvm\.gc-log\.present \| 无法判断 \| GC 日志：未采集 \| 补充可信 JVM 启动参数来源后人工核查。/);
});

test('report generation rejects untrusted carriers with structured, non-sensitive errors', async () => {
  await assert.rejects(
    generateTomcatMarkdownReport({ pastedLogCarrier: sampleLog }),
    (error) => error.code === 'MIDDLEWARE_REQUIRED' && error.path === 'selectedMiddleware'
  );

  await assert.rejects(
    generateTomcatMarkdownReport({ selectedMiddleware: 'tomcat', pastedLogCarrier: `${sampleLog}\n${sampleLog}` }),
    (error) => error.code === 'BOUNDARY_COUNT_INVALID' && !error.message.includes(sampleLog)
  );

  await assert.rejects(
    generateTomcatMarkdownReport({ selectedMiddleware: 'tomcat', pastedLogCarrier: sampleLog.replace('"middleware":"tomcat"', '"middleware":"jetty"') }),
    (error) => error.code === 'MIDDLEWARE_MISMATCH' && error.path === 'middleware'
  );

  await assert.rejects(
    generateTomcatMarkdownReport({ selectedMiddleware: 'tomcat', pastedLogCarrier: sampleLog.replace('"protocolVersion":"tomcat-inspection-log/v1"', '"protocolVersion":"v0"') }),
    (error) => error.code === 'PROTOCOL_UNSUPPORTED' && error.path === 'protocolVersion'
  );

  const invalidCarriers = [
    ['', 'BOUNDARY_COUNT_INVALID'],
    [`${LOG_END}\n{}\n${LOG_BEGIN}`, 'BOUNDARY_ORDER_INVALID'],
    [`${LOG_BEGIN}\nnot json\n${LOG_END}`, 'JSON_INVALID'],
    [sampleLog.replace('"middleware":"tomcat",', ''), 'MIDDLEWARE_MISSING'],
    [sampleLog.replace('"protocolVersion":"tomcat-inspection-log/v1",', ''), 'PROTOCOL_MISSING'],
    [sampleLog.replace('"host":{"hostname":"demo-host","ip":"192.0.2.10"}', '"host":null'), 'DOCUMENT_SCHEMA_INVALID']
  ];
  for (const [carrier, code] of invalidCarriers) {
    await assert.rejects(
      generateTomcatMarkdownReport({ selectedMiddleware: 'tomcat', pastedLogCarrier: carrier }),
      (error) => error.code === code && !error.message.includes('demo-host')
    );
  }
});

test('report generation application boundary also accepts an uploaded log file buffer', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    uploadedFile: {
      name: 'tomcat.log',
      content: Buffer.from(sampleLog, 'utf8')
    },
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.equal(result.reports.length, 1);
  assert.match(result.reports[0].markdown, /# Tomcat 单实例巡检报告/);
  assert.match(result.reports[0].markdown, /tomcat.jvm.xmx.present \| 正常/);
});
