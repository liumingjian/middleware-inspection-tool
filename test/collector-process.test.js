import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    instanceId: 'demo-host:12345',
    pid: 12345,
    catalinaBase: '/opt/tomcat-demo',
    httpPort: 8080,
    checks: [
      {
        id: 'tomcat.http.port.present',
        observedValue: 8080,
        evidence: 'TOMCAT_INSPECTOR_HTTP_PORT'
      }
    ]
  });
});
