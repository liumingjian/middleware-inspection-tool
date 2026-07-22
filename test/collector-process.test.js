import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const scriptPath = new URL('../scripts/tomcat-readonly-collector.sh', import.meta.url);

function parseCollectorOutput(output) {
  const start = '===TOMCAT_INSPECTION_JSON_BEGIN===';
  const end = '===TOMCAT_INSPECTION_JSON_END===';
  assert.equal(output.split(start).length - 1, 1);
  assert.equal(output.split(end).length - 1, 1);
  const jsonText = output.slice(output.indexOf(start) + start.length, output.indexOf(end)).trim();
  return JSON.parse(jsonText);
}

test('collector process emits one bounded Tomcat log document for the controlled scenario', () => {
  const output = execFileSync('bash', [scriptPath.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOMCAT_INSPECTOR_FIXED_TIME: '2026-07-21T00:00:00Z',
      TOMCAT_INSPECTOR_HOSTNAME: 'demo-host',
      TOMCAT_INSPECTOR_HOST_IP: '192.0.2.10',
      TOMCAT_INSPECTOR_PID: '12345',
      TOMCAT_INSPECTOR_CATALINA_BASE: '/opt/tomcat-demo',
      TOMCAT_INSPECTOR_TOMCAT_VERSION: '9.0.85',
      TOMCAT_INSPECTOR_JAVA_VERSION: '17.0.10',
      TOMCAT_INSPECTOR_JVM_ARGS: '-Xms512m -Xmx1024m -XX:+UseG1GC -Xlog:gc*:file=/var/log/tomcat/gc.log',
      TOMCAT_INSPECTOR_HTTP_PORT: '8080'
    }
  });

  const document = parseCollectorOutput(output);
  assert.equal(document.middleware, 'tomcat');
  assert.equal(document.protocolVersion, 'tomcat-inspection-log/v1');
  assert.equal(document.collectorVersion, 'tomcat-readonly-collector/0.1.0');
  assert.equal(document.collectedAt, '2026-07-21T00:00:00Z');
  assert.deepEqual(document.host, { hostname: 'demo-host', ip: '192.0.2.10' });
  assert.equal(document.instances.length, 1);
  assert.deepEqual(document.instances[0], {
    instanceId: '192.0.2.10:12345',
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
    checks: [
      {
        id: 'tomcat.instance.identity.present',
        observedValue: '192.0.2.10:12345',
        evidence: 'TOMCAT_INSPECTOR_PID,TOMCAT_INSPECTOR_CATALINA_BASE'
      },
      {
        id: 'tomcat.version.support',
        observedValue: '9.0.85',
        evidence: 'TOMCAT_INSPECTOR_TOMCAT_VERSION'
      },
      {
        id: 'tomcat.java.version.present',
        observedValue: '17.0.10',
        evidence: 'TOMCAT_INSPECTOR_JAVA_VERSION'
      },
      {
        id: 'tomcat.jvm.xms.present',
        observedValue: '512m',
        evidence: 'TOMCAT_INSPECTOR_JVM_ARGS'
      },
      {
        id: 'tomcat.jvm.xmx.present',
        observedValue: '1024m',
        evidence: 'TOMCAT_INSPECTOR_JVM_ARGS'
      },
      {
        id: 'tomcat.jvm.gc.present',
        observedValue: 'G1GC',
        evidence: 'TOMCAT_INSPECTOR_JVM_ARGS'
      },
      {
        id: 'tomcat.jvm.gc-log.present',
        observedValue: '/var/log/tomcat/gc.log',
        evidence: 'TOMCAT_INSPECTOR_JVM_ARGS'
      },
      {
        id: 'tomcat.http.port.present',
        observedValue: 8080,
        evidence: 'TOMCAT_INSPECTOR_HTTP_PORT'
      }
    ]
  });
});

test('collector records all discovery path outcomes and multiple visible instances', () => {
  const output = execFileSync('bash', [scriptPath.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOMCAT_INSPECTOR_FIXED_TIME: '2026-07-21T00:00:00Z',
      TOMCAT_INSPECTOR_HOSTNAME: 'demo-host',
      TOMCAT_INSPECTOR_HOST_IP: '192.0.2.10',
      TOMCAT_INSPECTOR_DISCOVERY: 'procfs:success:发现 2 个实例;ps:restricted:只能查看当前用户进程;systemd:unavailable:systemctl 不可用',
      TOMCAT_INSPECTOR_INSTANCES: '12345|/opt/tomcat-a|9.0.85|17.0.10|-Xms512m -Xmx1024m|8080;23456|/opt/tomcat-b|10.1.30|21.0.4|-Xms1g -Xmx2g|8180'
    }
  });

  const document = parseCollectorOutput(output);
  assert.deepEqual(document.discovery, [
    { method: 'procfs', status: 'success', detail: '发现 2 个实例' },
    { method: 'ps', status: 'restricted', detail: '只能查看当前用户进程' },
    { method: 'systemd', status: 'unavailable', detail: 'systemctl 不可用' }
  ]);
  assert.deepEqual(document.instances.map(({ instanceId }) => instanceId), [
    '192.0.2.10:12345',
    '192.0.2.10:23456'
  ]);
  assert.deepEqual(document.instances.map(({ catalinaBase }) => catalinaBase), [
    '/opt/tomcat-a',
    '/opt/tomcat-b'
  ]);
});

test('collector can report zero visible instances without claiming Tomcat is absent', () => {
  const output = execFileSync('bash', [scriptPath.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOMCAT_INSPECTOR_FIXED_TIME: '2026-07-21T00:00:00Z',
      TOMCAT_INSPECTOR_HOSTNAME: 'demo-host',
      TOMCAT_INSPECTOR_HOST_IP: '192.0.2.10',
      TOMCAT_INSPECTOR_DISCOVERY: 'procfs:success:当前用户未发现可见实例;ps:restricted:只能查看当前用户进程',
      TOMCAT_INSPECTOR_INSTANCES: ''
    }
  });

  const document = parseCollectorOutput(output);
  assert.deepEqual(document.instances, []);
  assert.equal(document.discovery[1].status, 'restricted');
  assert.doesNotMatch(JSON.stringify(document), /主机不存在 Tomcat/);
});

test('collector script stays within the read-only collection boundary', () => {
  const script = readFileSync(scriptPath, 'utf8');

  assert.doesNotMatch(script, /\b(?:jcmd|jstack|jmap|jattach)\b/);
  assert.doesNotMatch(script, /com\.sun\.tools\.attach|jmx|JMX/);
  assert.doesNotMatch(script, /\bsudo\b/);
});
