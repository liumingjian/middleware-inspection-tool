#!/usr/bin/env bash
set -euo pipefail

collector_version="tomcat-readonly-collector/0.1.0"
protocol_version="tomcat-inspection-log/v1"
collected_at="${TOMCAT_INSPECTOR_FIXED_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
hostname_value="${TOMCAT_INSPECTOR_HOSTNAME:-$(hostname 2>/dev/null || printf unknown-host)}"
host_ip="${TOMCAT_INSPECTOR_HOST_IP:-127.0.0.1}"
pid_value="${TOMCAT_INSPECTOR_PID:-1}"
catalina_base="${TOMCAT_INSPECTOR_CATALINA_BASE:-/opt/tomcat}"
http_port="${TOMCAT_INSPECTOR_HTTP_PORT:-8080}"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

hostname_json=$(printf '%s' "$hostname_value" | json_escape)
host_ip_json=$(printf '%s' "$host_ip" | json_escape)
catalina_base_json=$(printf '%s' "$catalina_base" | json_escape)

printf '%s\n' '===TOMCAT_INSPECTION_JSON_BEGIN==='
printf '{'
printf '"middleware":"tomcat",'
printf '"protocolVersion":"%s",' "$protocol_version"
printf '"collectorVersion":"%s",' "$collector_version"
printf '"collectedAt":"%s",' "$collected_at"
printf '"host":{"hostname":%s,"ip":%s},' "$hostname_json" "$host_ip_json"
printf '"instances":[{'
printf '"instanceId":"%s:%s",' "$hostname_value" "$pid_value"
printf '"pid":%s,' "$pid_value"
printf '"catalinaBase":%s,' "$catalina_base_json"
printf '"httpPort":%s,' "$http_port"
printf '"checks":[{"id":"tomcat.http.port.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_HTTP_PORT"}]' "$http_port"
printf '}]'
printf '}\n'
printf '%s\n' '===TOMCAT_INSPECTION_JSON_END==='
