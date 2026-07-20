import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getTomcatScriptAsset, generateTomcatMarkdownReport } from '../src/tomcat-inspection.js';

const sampleLog = readFileSync(new URL('./fixtures/tomcat-single-instance.log', import.meta.url), 'utf8');

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

## 版本与时间

- 协议版本：tomcat-inspection-log/v1
- 采集脚本版本：tomcat-readonly-collector/0.1.0
- 规则版本：tomcat-rules/0.1.0
- 采集时间：2026-07-21T00:00:00Z
- 报告生成时间：2026-07-21T01:02:03Z

## 巡检结论

| 巡检项 | 结论 | 采集事实 | 建议 |
| --- | --- | --- | --- |
| tomcat.http.port.present | 正常 | HTTP 端口：8080 | 已采集到 Tomcat HTTP 端口，保持现有配置审查流程。 |
`);
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
  assert.match(result.reports[0].markdown, /tomcat.http.port.present \| 正常/);
});
