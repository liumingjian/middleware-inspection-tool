import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  generateTomcatMarkdownReport,
  getTomcatRuleCatalog,
  getTomcatVersionRuleVector,
  LOG_BEGIN,
  LOG_END,
  TOMCAT_RULE_VERSION
} from '../src/tomcat-inspection.js';

const sampleLog = readFileSync(new URL('./fixtures/tomcat-single-instance.log', import.meta.url), 'utf8');
const sampleDocument = JSON.parse(sampleLog.split(LOG_BEGIN)[1].split(LOG_END)[0]);

function carrier(instanceOverrides = {}, documentOverrides = {}) {
  return `${LOG_BEGIN}\n${JSON.stringify({
    ...sampleDocument,
    ...documentOverrides,
    instances: [{ ...sampleDocument.instances[0], ...instanceOverrides }]
  })}\n${LOG_END}`;
}

test('versioned rule catalog covers all six domains with reproducible rule contracts', () => {
  const catalog = getTomcatRuleCatalog();

  assert.equal(catalog.ruleVersion, TOMCAT_RULE_VERSION);
  assert.deepEqual(catalog.domains.map(({ id }) => id), [
    'host-resources',
    'instance-jvm-startup',
    'connector-thread-pool',
    'static-security',
    'application-deployment',
    'logging-file-status'
  ]);
  for (const domain of catalog.domains) {
    assert.ok(domain.checks.length > 0);
    for (const check of domain.checks) {
      assert.match(check.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      assert.ok(check.applicableVersions.length > 0);
      assert.ok(check.requiredFacts.length > 0);
      assert.ok(check.minimumEvidence.length > 0);
      assert.ok(check.rule.length > 0);
    }
  }
  const ids = catalog.domains.flatMap(({ checks }) => checks.map(({ id }) => id));
  assert.equal(new Set(ids).size, ids.length);
});

test('Tomcat 8.5 is explicitly legacy EOL while 9.0 and 10.1 have reproducible version vectors', () => {
  assert.deepEqual(getTomcatVersionRuleVector('8.5.100'), {
    status: 'legacy_eol', line: '8.5', javaMinimum: 7,
    connectorDefaults: { maxThreads: 200, acceptCount: 100, connectionTimeout: 20000 }
  });
  assert.deepEqual(getTomcatVersionRuleVector('9.0.93'), {
    status: 'supported', line: '9.0', javaMinimum: 8,
    connectorDefaults: { maxThreads: 200, acceptCount: 100, connectionTimeout: 20000 }
  });
  assert.deepEqual(getTomcatVersionRuleVector('10.1.30'), {
    status: 'supported', line: '10.1', javaMinimum: 11,
    connectorDefaults: { maxThreads: 200, acceptCount: 100, connectionTimeout: 20000 }
  });
  assert.deepEqual(getTomcatVersionRuleVector('11.0.0'), { status: 'unsupported', line: null });
  assert.deepEqual(getTomcatVersionRuleVector(''), { status: 'unknown', line: null });
});

test('structured and Markdown reports have fixed semantics, provenance and deterministic recommendations', async () => {
  const input = {
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: carrier(),
    generatedAt: '2026-07-21T01:02:03Z'
  };
  const first = await generateTomcatMarkdownReport(input);
  const second = await generateTomcatMarkdownReport(input);
  const report = first.reports[0];

  assert.deepEqual(second, first);
  assert.deepEqual(report.provenance, {
    collectorVersion: sampleDocument.collectorVersion,
    protocolVersion: sampleDocument.protocolVersion,
    ruleVersion: TOMCAT_RULE_VERSION,
    collectedAt: sampleDocument.collectedAt,
    generatedAt: '2026-07-21T01:02:03Z',
    snapshotBoundary: '本报告仅反映单次采集快照，不代表历史趋势或持续状态。'
  });
  assert.deepEqual(report.reportView.sections.map(({ id }) => id), [
    'report-notes', 'instance-overview', 'conclusion-summary', 'host-resources',
    'instance-jvm-startup', 'connector-thread-pool', 'static-security',
    'application-deployment', 'logging-file-status', 'unknown-and-limitations', 'appendix'
  ]);
  assert.deepEqual(Object.keys(report.conclusionSummary), ['normal', 'warning', 'abnormal', 'unknown', 'notApplicable']);
  assert.equal(report.reportView.overallRisk, undefined);
  assert.equal(report.reportView.overallHealth, undefined);
  assert.match(report.markdown, /## 报告说明/);
  assert.match(report.markdown, /## 实例概况/);
  assert.match(report.markdown, /## 实例与 JVM 启动域/);
  assert.match(report.markdown, /## 无法判断与采集限制/);
  assert.match(report.markdown, /## 附录/);
  assert.match(report.markdown, /本报告仅反映单次采集快照/);
  assert.doesNotMatch(report.markdown, /## 总体风险|## 总体健康等级|总体风险：|总体健康等级：/);
});

test('unsupported Tomcat reports retain the report catalog but downgrade every non-support conclusion', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: carrier({ tomcatVersion: '11.0.0' }),
    generatedAt: '2026-07-21T01:02:03Z'
  });
  const report = result.reports[0];

  assert.deepEqual(report.versionRuleVector, { status: 'unsupported', line: null });
  assert.equal(report.reportView.operatingMode, 'degraded');
  assert.deepEqual(report.reportView.checks.filter(({ id }) => id === 'tomcat.version.support').map(({ conclusion }) => conclusion), ['异常']);
  assert.ok(report.reportView.checks.filter(({ id }) => id !== 'tomcat.version.support').every(({ conclusion }) => conclusion === '无法判断'));
  assert.deepEqual(report.conclusionSummary, {
    normal: 0, warning: 0, abnormal: 1, unknown: 13, notApplicable: 0
  });
  assert.match(report.markdown, /当前 Tomcat 版本不受规则集支持，报告已降级/);
});

test('Tomcat 8.5 legacy EOL does not claim conforming rules are normal', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: carrier({ tomcatVersion: '8.5.100' }),
    generatedAt: '2026-07-21T01:02:03Z'
  });
  const report = result.reports[0];

  assert.equal(report.versionRuleVector.status, 'legacy_eol');
  assert.equal(report.reportView.operatingMode, 'degraded');
  assert.ok(report.reportView.checks.every(({ conclusion }) => conclusion !== '正常'));
  assert.deepEqual(report.reportView.checks.slice(0, 8).map(({ id, conclusion }) => ({ id, conclusion })), [
    { id: 'tomcat.instance.identity.present', conclusion: '无法判断' },
    { id: 'tomcat.version.support', conclusion: '异常' },
    { id: 'tomcat.java.version.present', conclusion: '无法判断' },
    { id: 'tomcat.jvm.xms.present', conclusion: '无法判断' },
    { id: 'tomcat.jvm.xmx.present', conclusion: '无法判断' },
    { id: 'tomcat.jvm.gc.present', conclusion: '无法判断' },
    { id: 'tomcat.jvm.gc-log.present', conclusion: '无法判断' },
    { id: 'tomcat.http.port.present', conclusion: '无法判断' }
  ]);
  assert.match(report.markdown, /Tomcat 8\.5 已停止维护，报告已降级/);
});
