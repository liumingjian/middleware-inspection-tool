import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import JSZip from 'jszip';
import { createTomcatReportSession } from '../src/report-revision.js';
import {
  generateTomcatMarkdownReport,
  LOG_BEGIN,
  LOG_END,
  TOMCAT_PROTOCOL_VERSION
} from '../src/tomcat-inspection.js';

const collectorPath = new URL('../scripts/tomcat-readonly-collector.sh', import.meta.url);

function collect(overrides = {}) {
  return execFileSync('bash', [collectorPath.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOMCAT_INSPECTOR_FIXED_TIME: '2026-07-22T00:00:00Z',
      TOMCAT_INSPECTOR_HOSTNAME: 'acceptance-host<&>',
      TOMCAT_INSPECTOR_HOST_IP: '192.0.2.24',
      TOMCAT_INSPECTOR_CPU_COUNT: '8',
      TOMCAT_INSPECTOR_DISK_STATUS: 'restricted',
      TOMCAT_INSPECTOR_INODE_STATUS: 'unavailable',
      TOMCAT_INSPECTOR_MEMORY_STATUS: 'unreliable',
      TOMCAT_INSPECTOR_DISCOVERY: 'procfs:success:发现可见实例;ps:restricted:权限不足;systemd:unavailable:工具缺失',
      TOMCAT_INSPECTOR_SECURITY_STATUS: 'restricted',
      TOMCAT_INSPECTOR_JVM_ARGS: '-Xmx1g -Ddb.password=acceptance-secret',
      ...overrides
    }
  });
}

function boundedDocument(carrier) {
  return JSON.parse(carrier.slice(carrier.indexOf(LOG_BEGIN) + LOG_BEGIN.length, carrier.indexOf(LOG_END)).trim());
}

async function reopenDocx(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const xml = await archive.file('word/document.xml').async('string');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const versions = ['8.5.100', '9.0.85', '10.1.30', '11.0.0'];
for (const version of versions) {
  test(`Tomcat ${version} collector output enters the report boundary unchanged`, async () => {
    const carrier = collect({
      TOMCAT_INSPECTOR_TOMCAT_VERSION: version,
      TOMCAT_INSPECTOR_PID: version.replaceAll('.', ''),
      TOMCAT_INSPECTOR_CATALINA_BASE: `/opt/tomcat-${version}`
    });
    const collected = boundedDocument(carrier);

    const result = await generateTomcatMarkdownReport({
      selectedMiddleware: 'tomcat',
      pastedLogCarrier: carrier,
      generatedAt: '2026-07-22T00:01:00Z'
    });

    assert.equal(collected.protocolVersion, TOMCAT_PROTOCOL_VERSION);
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].instanceId, collected.instances[0].instanceId);
    assert.equal(result.reports[0].discoveryComplete, false);
    assert.match(result.reports[0].markdown, /主机资源域/);
    assert.match(result.reports[0].markdown, /实例与 JVM 启动域/);
    assert.match(result.reports[0].markdown, /Connector 与线程池域/);
    assert.match(result.reports[0].markdown, /静态配置安全域/);
    assert.match(result.reports[0].markdown, /应用部署概况域/);
    assert.match(result.reports[0].markdown, /日志配置与文件状态域/);
    assert.match(result.reports[0].markdown, /观察指标（不参与结论计数）/);
    assert.doesNotMatch(JSON.stringify(collected), /acceptance-secret/);
  });
}

test('real multi-instance collector output supports revision, one DOCX, and an all-instance ZIP', async () => {
  const carrier = collect({
    TOMCAT_INSPECTOR_INSTANCES: '24001|/opt/tomcat-a|9.0.85|17.0.10|-Xms512m -Xmx1g|8080;24002|/opt/tomcat-b|10.1.30|21.0.4|-Xms1g -Xmx2g|8180'
  });
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: carrier,
    generatedAt: '2026-07-22T00:01:00Z'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.reports.length, 2);
  assert.ok(result.reports.every(({ conclusionSummary }) =>
    ['normal', 'warning', 'abnormal', 'unknown', 'notApplicable'].every((key) => Number.isInteger(conclusionSummary[key]))));
  const session = createTomcatReportSession(result.reports);
  const first = result.reports[0];
  session.updateMarkdown(first.instanceId, first.markdown.replace('本报告仅反映单次采集快照', '用户确认：本报告仅反映单次采集快照'));

  const single = await session.exportDocx(first.instanceId);
  const singleText = await reopenDocx(single.content);
  assert.equal(single.reportType, 'user-revised');
  assert.match(singleText, /用户确认：本报告仅反映单次采集快照/);
  assert.match(singleText, /主机资源域/);

  const batch = await session.exportAllDocxZip();
  const zip = await JSZip.loadAsync(batch.content);
  const files = Object.keys(zip.files).filter((name) => name.endsWith('.docx'));
  assert.equal(files.length, 2);
  const texts = await Promise.all(files.map(async (name) => reopenDocx(await zip.file(name).async('nodebuffer'))));
  assert.ok(texts.some((text) => text.includes('用户确认：本报告仅反映单次采集快照')));
  assert.ok(texts.every((text) => text.includes('不生成总体风险或总体健康等级')));
  assert.ok(texts.every((text) => text.includes('不读取或分析日志正文')));
  assert.ok(texts.every((text) => !/持续监控|性能诊断|巡检历史|会话恢复/.test(text)));
});

test('protocol damage and partial invalid instances fail only at their documented boundaries', async () => {
  const carrier = collect({ TOMCAT_INSPECTOR_TOMCAT_VERSION: '9.0.85' });
  const damaged = [
    ['', 'BOUNDARY_COUNT_INVALID'],
    [carrier.slice(0, carrier.indexOf(LOG_END)), 'BOUNDARY_COUNT_INVALID'],
    [carrier.replace(TOMCAT_PROTOCOL_VERSION, 'tomcat-inspection-log/v0'), 'PROTOCOL_UNSUPPORTED'],
    [carrier.replace(/\{\"middleware\":/, '{broken:"middleware":'), 'JSON_INVALID']
  ];
  for (const [input, code] of damaged) {
    await assert.rejects(
      generateTomcatMarkdownReport({ selectedMiddleware: 'tomcat', pastedLogCarrier: input }),
      (error) => error.code === code
    );
  }

  const document = boundedDocument(carrier);
  document.instances.push({ instanceId: 'bad', pid: 'truncated', catalinaBase: '', checks: [] });
  const partial = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: `${LOG_BEGIN}\n${JSON.stringify(document)}\n${LOG_END}`
  });
  assert.equal(partial.status, 'partial_success');
  assert.equal(partial.reports.length, 1);
  assert.equal(partial.invalidInstances.length, 1);
});

test('collector remains low-privilege, read-only, and free of persistence behavior', () => {
  const script = readFileSync(collectorPath, 'utf8');
  assert.doesNotMatch(script, /\bsudo\b|\b(?:jcmd|jstack|jmap|jattach)\b/);
  assert.doesNotMatch(script, /\b(?:rm|mv|cp|chmod|chown|systemctl|service|kill)\b/);
  assert.doesNotMatch(script, /history|session|database|sqlite/i);
});
