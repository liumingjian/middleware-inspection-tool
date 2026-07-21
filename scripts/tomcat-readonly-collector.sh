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
tomcat_version="${TOMCAT_INSPECTOR_TOMCAT_VERSION:-unknown}"
java_version="${TOMCAT_INSPECTOR_JAVA_VERSION:-unknown}"
jvm_args="${TOMCAT_INSPECTOR_JVM_ARGS:-}"

split_jvm_args() {
  python3 -c 'import json,shlex,sys; print(json.dumps(shlex.split(sys.stdin.read())))'
}

extract_jvm_fact() {
  local key="$1"
  python3 -c '
import shlex,sys
key=sys.argv[1]
args=shlex.split(sys.stdin.read())
value=""
for arg in args:
    if key == "xms" and arg.startswith("-Xms"):
        value=arg[4:]
    elif key == "xmx" and arg.startswith("-Xmx"):
        value=arg[4:]
    elif key == "gc" and arg.startswith("-XX:+Use") and arg.endswith("GC"):
        value=arg[len("-XX:+Use"):-len("GC")] + "GC"
    elif key == "gcLog" and arg.startswith("-Xlog:") and "file=" in arg:
        value=arg.split("file=", 1)[1].split(":", 1)[0]
print(value)
' "$key"
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

hostname_json=$(printf '%s' "$hostname_value" | json_escape)
host_ip_json=$(printf '%s' "$host_ip" | json_escape)
catalina_base_json=$(printf '%s' "$catalina_base" | json_escape)
tomcat_version_json=$(printf '%s' "$tomcat_version" | json_escape)
java_version_json=$(printf '%s' "$java_version" | json_escape)
jvm_args_json=$(printf '%s' "$jvm_args" | split_jvm_args)
jvm_xms=$(printf '%s' "$jvm_args" | extract_jvm_fact xms)
jvm_xmx=$(printf '%s' "$jvm_args" | extract_jvm_fact xmx)
jvm_gc=$(printf '%s' "$jvm_args" | extract_jvm_fact gc)
jvm_gc_log=$(printf '%s' "$jvm_args" | extract_jvm_fact gcLog)
jvm_xms_json=$(printf '%s' "$jvm_xms" | json_escape)
jvm_xmx_json=$(printf '%s' "$jvm_xmx" | json_escape)
jvm_gc_json=$(printf '%s' "$jvm_gc" | json_escape)
jvm_gc_log_json=$(printf '%s' "$jvm_gc_log" | json_escape)

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
printf '"tomcatVersion":%s,' "$tomcat_version_json"
printf '"javaVersion":%s,' "$java_version_json"
printf '"jvmStartup":{"source":"TOMCAT_INSPECTOR_JVM_ARGS","trusted":true,"args":%s,"xms":%s,"xmx":%s,"gc":%s,"gcLog":%s},' "$jvm_args_json" "$jvm_xms_json" "$jvm_xmx_json" "$jvm_gc_json" "$jvm_gc_log_json"
printf '"httpPort":%s,' "$http_port"
printf '"checks":['
printf '{"id":"tomcat.instance.identity.present","observedValue":"%s:%s","evidence":"TOMCAT_INSPECTOR_PID,TOMCAT_INSPECTOR_CATALINA_BASE"},' "$hostname_value" "$pid_value"
printf '{"id":"tomcat.version.support","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_TOMCAT_VERSION"},' "$tomcat_version_json"
printf '{"id":"tomcat.java.version.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_JAVA_VERSION"},' "$java_version_json"
printf '{"id":"tomcat.jvm.xms.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},' "$jvm_xms_json"
printf '{"id":"tomcat.jvm.xmx.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},' "$jvm_xmx_json"
printf '{"id":"tomcat.jvm.gc.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},' "$jvm_gc_json"
printf '{"id":"tomcat.jvm.gc-log.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},' "$jvm_gc_log_json"
printf '{"id":"tomcat.http.port.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_HTTP_PORT"}' "$http_port"
printf ']'
printf '}]'
printf '}\n'
printf '%s\n' '===TOMCAT_INSPECTION_JSON_END==='
