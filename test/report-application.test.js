import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getTomcatScriptAsset, generateTomcatMarkdownReport, LOG_BEGIN, LOG_END } from '../src/tomcat-inspection.js';

const sampleLog = readFileSync(new URL('./fixtures/tomcat-single-instance.log', import.meta.url), 'utf8');

function buildCarrier(instanceOverrides, documentOverrides = {}) {
  const sampleDocument = JSON.parse(sampleLog.split(LOG_BEGIN)[1].split(LOG_END)[0]);
  const document = {
    middleware: 'tomcat',
    protocolVersion: 'tomcat-inspection-log/v1',
    collectorVersion: 'tomcat-readonly-collector/0.1.0',
    collectedAt: '2026-07-21T00:00:00Z',
    host: { hostname: 'demo-host', ip: '192.0.2.10' },
    instances: [
      {
        ...sampleDocument.instances[0],
        ...instanceOverrides
      }
    ],
    discovery: [{ method: 'configured-input', status: 'success', detail: '按显式采集参数发现实例' }],
    ...documentOverrides
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

test('report generation rejects missing or invalid discovery outcomes', async () => {
  await assert.rejects(
    generateTomcatMarkdownReport({
      selectedMiddleware: 'tomcat',
      pastedLogCarrier: buildCarrier({}, { discovery: undefined })
    }),
    (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'discovery'
  );

  await assert.rejects(
    generateTomcatMarkdownReport({
      selectedMiddleware: 'tomcat',
      pastedLogCarrier: buildCarrier({}, {
        discovery: [{ method: 'procfs', status: 'unknown', detail: '状态无效' }]
      })
    }),
    (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'discovery[0]'
  );
});

test('report generation processes every valid instance in one trusted log', async () => {
  const secondInstance = {
    instanceId: '192.0.2.10:23456',
    pid: 23456,
    catalinaBase: '/opt/tomcat-second',
    tomcatVersion: '10.1.30',
    javaVersion: '21.0.4',
    jvmStartup: { source: 'ps.args', trusted: false, args: [] },
    checks: []
  };
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, {
      instances: [
        JSON.parse(buildCarrier({}).split(LOG_BEGIN)[1].split(LOG_END)[0]).instances[0],
        secondInstance
      ]
    }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.reports.map(({ instanceId }) => instanceId), ['demo-host:12345', '192.0.2.10:23456']);
  assert.deepEqual(result.invalidInstances, []);
});

test('report generation returns partial success and locatable reasons without omitting invalid instances', async () => {
  const validInstance = JSON.parse(buildCarrier({}).split(LOG_BEGIN)[1].split(LOG_END)[0]).instances[0];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, {
      discovery: [{ method: 'procfs', status: 'success', detail: '发现 1 个实例' }],
      instances: [
        validInstance,
        { instanceId: '192.0.2.10:bad-pid', pid: 'bad-pid', catalinaBase: '', checks: [] }
      ]
    }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.equal(result.status, 'partial_success');
  assert.deepEqual(result.reports.map(({ instanceId }) => instanceId), ['demo-host:12345']);
  assert.deepEqual(result.invalidInstances, [{
    index: 1,
    instanceId: '192.0.2.10:bad-pid',
    reasons: [
      { path: 'instances[1].pid', code: 'INSTANCE_PID_INVALID', message: '实例进程号必须是正整数。' },
      { path: 'instances[1].catalinaBase', code: 'INSTANCE_CATALINA_BASE_INVALID', message: '实例 CATALINA_BASE 不能为空。' }
    ]
  }]);
});

test('report generation with no valid instance produces no report and recommends manual verification', async () => {
  const discovery = [
    { method: 'procfs', status: 'restricted', detail: '部分进程目录不可读' },
    { method: 'ps', status: 'unavailable', detail: 'ps 命令不可用' }
  ];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, {
      discovery,
      instances: [{ instanceId: '192.0.2.10:bad-pid', pid: 'bad-pid', catalinaBase: '', checks: [] }]
    })
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.reports, []);
  assert.equal(result.invalidInstances.length, 1);
  assert.deepEqual(result.discovery, discovery);
  assert.equal(result.manualReviewAdvice, '未发现有效 Tomcat 实例。请结合发现途径状态人工核查主机上的 Tomcat 进程。');
});

test('zero visible instances remains distinct from proving that Tomcat is absent', async () => {
  const discovery = [
    { method: 'procfs', status: 'success', detail: '当前用户未发现可见 Tomcat 进程' },
    { method: 'ps', status: 'restricted', detail: '只能查看当前用户进程' }
  ];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, { discovery, instances: [] })
  });

  assert.equal(result.status, 'no_visible_instances');
  assert.deepEqual(result.reports, []);
  assert.deepEqual(result.invalidInstances, []);
  assert.deepEqual(result.discovery, discovery);
  assert.match(result.manualReviewAdvice, /不代表主机不存在 Tomcat/);
});

test('incomplete discovery remains visible in the instance list and every generated report', async () => {
  const discovery = [
    { method: 'procfs', status: 'success', detail: '发现 1 个实例' },
    { method: 'ps', status: 'restricted', detail: '只能查看当前用户进程' },
    { method: 'systemd', status: 'unavailable', detail: 'systemctl 不可用' }
  ];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, { discovery })
  });

  assert.equal(result.discoveryComplete, false);
  assert.deepEqual(result.discovery, discovery);
  assert.equal(result.reports[0].discoveryComplete, false);
  assert.match(result.reports[0].markdown, /## 实例发现覆盖范围/);
  assert.match(result.reports[0].markdown, /ps：受限（只能查看当前用户进程）/);
  assert.match(result.reports[0].markdown, /systemd：不可用（systemctl 不可用）/);
  assert.match(result.reports[0].markdown, /已发现实例仍可生成报告，但实例清单可能不完整/);
});

test('report generation application boundary turns a pasted Tomcat log carrier into one Markdown report', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: sampleLog,
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].instanceId, 'demo-host:12345');
  assert.match(result.reports[0].markdown, /## 实例发现覆盖范围/);
  assert.match(result.reports[0].markdown, /configured-input：成功（按显式采集参数发现实例）/);
  assert.match(result.reports[0].markdown, /所有记录的实例发现途径均成功。/);
  assert.match(result.reports[0].markdown, /## JVM 启动配置/);
  assert.match(result.reports[0].markdown, /tomcat\.http\.port\.present \| 正常 \| HTTP 端口：8080/);
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

test('report generation analyzes reliable host capacity facts and excludes observations from conclusion counts', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, {
      host: {
        hostname: 'demo-host',
        ip: '192.0.2.10',
        resources: {
          disk: { status: 'success', source: 'df -Pk /opt', unit: 'bytes', mount: '/opt', total: 1000, available: 50, usedPercent: 95 },
          inode: { status: 'success', source: 'df -Pi /opt', unit: 'inodes', mount: '/opt', total: 1000, available: 150, usedPercent: 85 },
          memory: { status: 'success', source: '/proc/meminfo:MemAvailable', unit: 'bytes', total: 1000, available: 250, usedPercent: 75 }
        },
        observations: [
          { id: 'host.cpu.instantaneous', status: 'success', source: 'snapshot', unit: 'percent', value: 99 },
          { id: 'host.load.instantaneous', status: 'success', source: 'snapshot', unit: 'load', value: 8.5 }
        ]
      }
    }),
    generatedAt: '2026-07-21T01:02:03Z'
  });

  assert.deepEqual(result.reports[0].conclusionSummary, {
    normal: 9,
    warning: 1,
    abnormal: 1,
    unknown: 2,
    notApplicable: 0
  });
  assert.deepEqual(result.reports[0].hostResourceChecks, [
    { id: 'host.disk.capacity', domain: 'host-resources', conclusion: '异常', evidence: '挂载点 /opt，已用 95%，可用 50 bytes（df -Pk /opt）', suggestion: '评估并释放磁盘空间或扩容；变更前完成影响评估、备份并遵循客户变更流程。' },
    { id: 'host.inode.capacity', domain: 'host-resources', conclusion: '警告', evidence: '挂载点 /opt，已用 85%，可用 150 inodes（df -Pi /opt）', suggestion: '核查 inode 消耗来源并规划清理或扩容；变更前完成影响评估、备份并遵循客户变更流程。' },
    { id: 'host.memory.available', domain: 'host-resources', conclusion: '正常', evidence: '可用内存 250 bytes，占总量 25%（/proc/meminfo:MemAvailable）', suggestion: '可用内存容量满足当前静态基线，继续结合长期监控评估。' }
  ]);
  const markdown = result.reports[0].markdown;
  assert.match(markdown, /## 结论摘要/);
  assert.match(markdown, /正常：9；警告：1；异常：1；无法判断：2；不适用：0/);
  assert.match(markdown, /## 主机资源域/);
  assert.match(markdown, /host\.disk\.capacity \| 异常/);
  assert.match(markdown, /## 观察指标（不参与结论计数）/);
  assert.match(markdown, /host\.cpu\.instantaneous：99 percent/);
  assert.match(markdown, /host\.load\.instantaneous：8\.5 load/);
});

test('report generation marks applicable host capacity checks unknown when minimum evidence is unavailable', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({}, {
      host: {
        hostname: 'demo-host',
        ip: '192.0.2.10',
        resources: {
          disk: { status: 'restricted', source: 'df -Pk /opt', unit: 'bytes' },
          inode: { status: 'unavailable', source: 'df -Pi /opt', unit: 'inodes' },
          memory: { status: 'unreliable', source: '/proc/meminfo:MemAvailable', unit: 'bytes' }
        },
        observations: []
      }
    })
  });

  assert.deepEqual(result.reports[0].hostResourceChecks.map(({ conclusion }) => conclusion), ['无法判断', '无法判断', '无法判断']);
  assert.equal(result.reports[0].conclusionSummary.unknown, 5);
  assert.match(result.reports[0].markdown, /host\.memory\.available \| 无法判断 \| 采集状态：unreliable；来源：\/proc\/meminfo:MemAvailable/);
  assert.doesNotMatch(result.reports[0].markdown, /host\.memory\.available \| 正常/);
});

test('report generation marks missing host resource facts unknown instead of omitting applicable checks', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({})
  });

  assert.deepEqual(result.reports[0].hostResourceChecks.map(({ id, conclusion }) => ({ id, conclusion })), [
    { id: 'host.disk.capacity', conclusion: '无法判断' },
    { id: 'host.inode.capacity', conclusion: '无法判断' },
    { id: 'host.memory.available', conclusion: '无法判断' }
  ]);
  assert.equal(result.reports[0].conclusionSummary.unknown, 5);
});

test('report generation rejects malformed observations and inconsistent capacity facts at the report boundary', async () => {
  const invalidHosts = [
    {
      resources: {
        disk: { status: 'success', source: 'df', unit: 'bytes', mount: '/opt', total: 1000, available: 1001, usedPercent: 0 },
        inode: { status: 'unavailable', source: 'df', unit: 'inodes' },
        memory: { status: 'unavailable', source: '/proc/meminfo', unit: 'bytes' }
      },
      observations: []
    },
    {
      resources: {
        disk: { status: 'unavailable', source: 'df', unit: 'bytes' },
        inode: { status: 'unavailable', source: 'df', unit: 'inodes' },
        memory: { status: 'unavailable', source: '/proc/meminfo', unit: 'bytes' }
      },
      observations: [{ id: 'host.cpu.instantaneous', status: 'success', source: 'snapshot', unit: 'percent' }]
    }
  ];
  for (const host of invalidHosts) {
    await assert.rejects(
      generateTomcatMarkdownReport({
        selectedMiddleware: 'tomcat',
        pastedLogCarrier: buildCarrier({}, { host: { hostname: 'demo-host', ip: '192.0.2.10', ...host } })
      }),
      (error) => error.code === 'DOCUMENT_SCHEMA_INVALID'
    );
  }
});

test('report generation rejects malformed host resource facts at the report boundary', async () => {
  await assert.rejects(
    generateTomcatMarkdownReport({
      selectedMiddleware: 'tomcat',
      pastedLogCarrier: buildCarrier({}, {
        host: {
          hostname: 'demo-host',
          ip: '192.0.2.10',
          resources: {
            disk: { status: 'success', source: 'df', unit: 'bytes', total: 1000, available: 50 },
            inode: { status: 'unavailable', source: 'df', unit: 'inodes' },
            memory: { status: 'unavailable', source: '/proc/meminfo', unit: 'bytes' }
          },
          observations: []
        }
      })
    }),
    (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'host.resources.disk'
  );
});

test('report marks uncollected Connector configuration unknown instead of omitting the domain', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ connectors: [] })
  });

  assert.deepEqual(result.reports[0].connectorChecks.map(({ id, conclusion, semantics }) => ({ id, conclusion, semantics })), [
    { id: 'tomcat.connector.configuration', conclusion: '无法判断', semantics: 'minimum-evidence' }
  ]);
  assert.equal(result.reports[0].conclusionSummary.unknown, 5);
  assert.match(result.reports[0].markdown, /采集状态：unavailable；证据：未采集 Connector 配置事实/);
});

test('report rejects invalid host CPU capacity facts at the boundary', async () => {
  await assert.rejects(
    generateTomcatMarkdownReport({
      selectedMiddleware: 'tomcat',
      pastedLogCarrier: buildCarrier({}, { host: { hostname: 'demo-host', ip: '192.0.2.10', cpuCount: 0 } })
    }),
    (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'host.cpuCount'
  );
});

test('report distinguishes Connector value sources and rule semantics', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({
      connectors: [{
        status: 'success',
        evidence: 'server.xml Connector line 20; Executor shared-http line 8',
        protocolHandler: 'org.apache.coyote.http11.Http11NioProtocol',
        port: { value: 8080, source: 'explicit' },
        executor: 'shared-http',
        maxThreads: { value: 16, source: 'reference' },
        acceptCount: { value: 100, source: 'version-default' },
        connectionTimeout: { value: 0, source: 'explicit' }
      }]
    }, {
      host: {
        hostname: 'demo-host', ip: '192.0.2.10', cpuCount: 8,
        resources: {
          disk: { status: 'unavailable', source: 'df', unit: 'bytes' },
          inode: { status: 'unavailable', source: 'df', unit: 'inodes' },
          memory: { status: 'unavailable', source: '/proc/meminfo', unit: 'bytes' }
        }, observations: []
      }
    })
  });

  assert.deepEqual(result.reports[0].connectorChecks.map(({ id, conclusion, semantics }) => ({ id, conclusion, semantics })), [
    { id: 'tomcat.connector.connection-timeout', conclusion: '异常', semantics: 'correctness-baseline' },
    { id: 'tomcat.thread-pool.host-capacity', conclusion: '警告', semantics: 'host-capacity-baseline' },
    { id: 'tomcat.connector.accept-count', conclusion: '不适用', semantics: 'workload-tuning' }
  ]);
  const markdown = result.reports[0].markdown;
  assert.match(markdown, /## Connector 与线程池域/);
  assert.match(markdown, /端口：8080（显式值）/);
  assert.match(markdown, /maxThreads：16（静态引用值）/);
  assert.match(markdown, /acceptCount：100（Tomcat 版本默认值）/);
  assert.match(markdown, /server\.xml Connector line 20; Executor shared-http line 8/);
  assert.match(markdown, /先核查影响并通过客户变更流程调整/);
});

test('report leaves unresolvable Connector facts unknown without guessing defaults', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ connectors: [{ status: 'restricted', evidence: 'server.xml permission denied' }] })
  });

  assert.deepEqual(result.reports[0].connectorChecks.map(({ conclusion }) => conclusion), ['无法判断']);
  assert.match(result.reports[0].markdown, /采集状态：restricted/);
  assert.match(result.reports[0].markdown, /server\.xml permission denied/);
  assert.doesNotMatch(result.reports[0].markdown, /Tomcat 版本默认值/);
});

test('report rejects malformed Connector value-source facts at the boundary', async () => {
  await assert.rejects(generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ connectors: [{
      status: 'success', evidence: 'server.xml', protocolHandler: 'HTTP/1.1',
      port: { value: 8080, source: 'guessed-default' }, executor: '',
      maxThreads: { value: 200, source: 'explicit' }, acceptCount: { value: 100, source: 'explicit' },
      connectionTimeout: { value: 20000, source: 'explicit' }
    }] })
  }), (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'instances[0].connectors[0].port');
});

test('report renders deterministic static security rules across all conclusion states without claiming a complete assessment', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({
      securityConfig: {
        status: 'success',
        source: 'local-static-config',
        directoryListingEnabled: true,
        autoDeployEnabled: true,
        serverInfoExposed: false,
        shutdownPort: -1,
        tlsConnectorPresent: false
      }
    })
  });

  assert.deepEqual(result.reports[0].securityChecks.map(({ id, conclusion }) => ({ id, conclusion })), [
    { id: 'tomcat.security.directory-listing', conclusion: '异常' },
    { id: 'tomcat.security.auto-deploy', conclusion: '警告' },
    { id: 'tomcat.security.server-info', conclusion: '正常' },
    { id: 'tomcat.security.shutdown-port', conclusion: '正常' },
    { id: 'tomcat.security.tls-connector', conclusion: '不适用' }
  ]);
  const markdown = result.reports[0].markdown;
  assert.match(markdown, /## 静态配置安全域/);
  assert.match(markdown, /tomcat\.security\.directory-listing \| 异常/);
  assert.match(markdown, /先核查应用依赖并通过客户变更流程关闭目录列表/);
  assert.doesNotMatch(markdown, /(?:sed|curl|chmod|systemctl)\s/);
  assert.match(markdown, /仅覆盖本地静态配置基线，不执行 CVE 匹配、主动探测或登录尝试，也不构成完整安全评估/);
});

test('report marks unreadable security configuration unknown with minimum evidence', async () => {
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ securityConfig: { status: 'restricted', source: 'local-static-config' } })
  });

  assert.deepEqual(result.reports[0].securityChecks, [{
    id: 'tomcat.security.configuration',
    domain: 'static-security',
    conclusion: '无法判断',
    evidence: '采集状态：restricted；来源：local-static-config',
    suggestion: '补充可读的本地静态安全配置事实后人工核查。'
  }]);
});

test('report rejects malformed security configuration facts at the boundary', async () => {
  await assert.rejects(generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ securityConfig: {
      status: 'success', source: 'local-static-config', directoryListingEnabled: 'false',
      autoDeployEnabled: false, serverInfoExposed: false, shutdownPort: -1, tlsConnectorPresent: true
    } })
  }), (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'instances[0].securityConfig');
});

test('report renders deterministic deployment inventory checks and Markdown without inferring relationships', async () => {
  const deployments = [
    {
      status: 'success', source: 'inventory:/opt/tomcat/webapps', applicationName: 'orders',
      deploymentPath: '/opt/tomcat/webapps/orders', deploymentType: 'exploded-directory',
      containerConfig: { contextPath: '/orders', reloadable: true, deployOnStartup: true, unpackWARs: true }
    },
    {
      status: 'success', source: 'context:/opt/tomcat/conf/Catalina/localhost/billing.xml', applicationName: 'billing',
      deploymentPath: '/srv/apps/billing.war', deploymentType: 'external-war',
      containerConfig: { contextPath: '/billing', reloadable: false, deployOnStartup: true, unpackWARs: false }
    }
  ];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ deployments })
  });

  assert.deepEqual(result.reports[0].deploymentChecks.map(({ id, conclusion }) => ({ id, conclusion })), [
    { id: 'tomcat.application.deployment.inventory', conclusion: '正常' },
    { id: 'tomcat.application.deployment.inventory', conclusion: '正常' }
  ]);
  const markdown = result.reports[0].markdown;
  assert.match(markdown, /## 应用部署概况域/);
  assert.match(markdown, /orders；路径：\/opt\/tomcat\/webapps\/orders；形态：exploded-directory/);
  assert.match(markdown, /上下文路径：\/orders；reloadable：true；deployOnStartup：true；unpackWARs：true/);
  assert.match(markdown, /billing；路径：\/srv\/apps\/billing\.war；形态：external-war/);
  assert.match(markdown, /仅报告可见的部署清单与容器配置事实，不读取 WAR 内容、不扫描应用配置、不调用业务接口，也不推断应用或集群关系/);
});

test('report degrades deployment facts independently and preserves coverage limitations', async () => {
  const deployments = [
    { status: 'restricted', source: 'inventory:/secure/webapps' },
    { status: 'unavailable', source: 'context:/opt/tomcat/conf/Catalina/localhost/app.xml' },
    { status: 'unreliable', source: 'deployment-source' }
  ];
  const result = await generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ deployments })
  });

  assert.deepEqual(result.reports[0].deploymentChecks.map(({ conclusion }) => conclusion), ['无法判断', '无法判断', '无法判断']);
  assert.match(result.reports[0].markdown, /采集状态：restricted；来源：inventory:\/secure\/webapps/);
  assert.match(result.reports[0].markdown, /应用部署清单可能不完整/);
});

test('report rejects malformed deployment facts at the boundary', async () => {
  await assert.rejects(generateTomcatMarkdownReport({
    selectedMiddleware: 'tomcat',
    pastedLogCarrier: buildCarrier({ deployments: [{
      status: 'success', source: 'inventory:/opt/tomcat/webapps', applicationName: 'orders',
      deploymentPath: '/opt/tomcat/webapps/orders', deploymentType: 'guessed-cluster',
      containerConfig: { contextPath: '/orders', reloadable: true, deployOnStartup: true, unpackWARs: true }
    }] })
  }), (error) => error.code === 'DOCUMENT_SCHEMA_INVALID' && error.path === 'instances[0].deployments[0]');
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
