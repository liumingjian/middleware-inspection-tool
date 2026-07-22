#!/usr/bin/env bash
set -euo pipefail

collector_version="tomcat-readonly-collector/0.1.0"
protocol_version="tomcat-inspection-log/v1"
collected_at="${TOMCAT_INSPECTOR_FIXED_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
hostname_value="${TOMCAT_INSPECTOR_HOSTNAME:-$(hostname 2>/dev/null || printf unknown-host)}"
host_ip="${TOMCAT_INSPECTOR_HOST_IP:-127.0.0.1}"

default_discovery="configured-input:success:按显式采集参数发现实例"

json_string() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '"%s"' "$value"
}

jvm_fact() {
  local args_text="$1" prefix="$2" arg value=""
  local -a args=()
  read -r -a args <<< "$args_text"
  for arg in "${args[@]}"; do
    if [[ "$arg" == "$prefix"* ]]; then
      value=${arg#"$prefix"}
    fi
  done
  printf '%s' "$value"
}

jvm_gc() {
  local args_text="$1" arg value=""
  local -a args=()
  read -r -a args <<< "$args_text"
  for arg in "${args[@]}"; do
    if [[ "$arg" == -XX:+Use*GC ]]; then
      value=${arg#-XX:+Use}
    fi
  done
  printf '%s' "$value"
}

jvm_gc_log() {
  local args_text="$1" arg value=""
  local -a args=()
  read -r -a args <<< "$args_text"
  for arg in "${args[@]}"; do
    if [[ "$arg" == -Xlog:*file=* ]]; then
      value=${arg#*file=}
      value=${value%%:*}
    fi
  done
  printf '%s' "$value"
}

json_args() {
  local args_text="$1" arg first=true
  local -a args=()
  read -r -a args <<< "$args_text"
  printf '['
  for arg in "${args[@]}"; do
    if [[ "$first" == false ]]; then printf ','; fi
    json_string "$arg"
    first=false
  done
  printf ']'
}

emit_instance() {
  local pid="$1" catalina_base="$2" tomcat_version="$3" java_version="$4" args_text="$5" http_port="$6"
  local instance_id="${host_ip}:${pid}"
  local xms xmx gc gc_log trusted=false source=""
  xms=$(jvm_fact "$args_text" '-Xms')
  xmx=$(jvm_fact "$args_text" '-Xmx')
  gc=$(jvm_gc "$args_text")
  gc_log=$(jvm_gc_log "$args_text")
  if [[ -n "$args_text" ]]; then
    trusted=true
    source="TOMCAT_INSPECTOR_JVM_ARGS"
  fi

  printf '{"instanceId":'; json_string "$instance_id"
  printf ',"pid":%s,"catalinaBase":' "$pid"; json_string "$catalina_base"
  printf ',"tomcatVersion":'; json_string "$tomcat_version"
  printf ',"javaVersion":'; json_string "$java_version"
  printf ',"jvmStartup":{"source":'; json_string "$source"
  printf ',"trusted":%s,"args":' "$trusted"; json_args "$args_text"
  printf ',"xms":'; json_string "$xms"
  printf ',"xmx":'; json_string "$xmx"
  printf ',"gc":'; json_string "$gc"
  printf ',"gcLog":'; json_string "$gc_log"
  printf '},"httpPort":%s,"checks":[' "$http_port"
  printf '{"id":"tomcat.instance.identity.present","observedValue":'; json_string "$instance_id"; printf ',"evidence":"TOMCAT_INSPECTOR_PID,TOMCAT_INSPECTOR_CATALINA_BASE"},'
  printf '{"id":"tomcat.version.support","observedValue":'; json_string "$tomcat_version"; printf ',"evidence":"TOMCAT_INSPECTOR_TOMCAT_VERSION"},'
  printf '{"id":"tomcat.java.version.present","observedValue":'; json_string "$java_version"; printf ',"evidence":"TOMCAT_INSPECTOR_JAVA_VERSION"},'
  printf '{"id":"tomcat.jvm.xms.present","observedValue":'; json_string "$xms"; printf ',"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},'
  printf '{"id":"tomcat.jvm.xmx.present","observedValue":'; json_string "$xmx"; printf ',"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},'
  printf '{"id":"tomcat.jvm.gc.present","observedValue":'; json_string "$gc"; printf ',"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},'
  printf '{"id":"tomcat.jvm.gc-log.present","observedValue":'; json_string "$gc_log"; printf ',"evidence":"TOMCAT_INSPECTOR_JVM_ARGS"},'
  printf '{"id":"tomcat.http.port.present","observedValue":%s,"evidence":"TOMCAT_INSPECTOR_HTTP_PORT"}' "$http_port"
  printf ']}'
}

emit_discovery() {
  local value="$1" entry method status detail first=true
  printf '['
  IFS=';' read -r -a entries <<< "$value"
  for entry in "${entries[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS=':' read -r method status detail <<< "$entry"
    if [[ "$first" == false ]]; then printf ','; fi
    printf '{"method":'; json_string "$method"
    printf ',"status":'; json_string "$status"
    printf ',"detail":'; json_string "$detail"
    printf '}'
    first=false
  done
  printf ']'
}

emit_instances_from_input() {
  local value="$1" entry pid catalina_base tomcat_version java_version args_text http_port first=true
  IFS=';' read -r -a entries <<< "$value"
  for entry in "${entries[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r pid catalina_base tomcat_version java_version args_text http_port <<< "$entry"
    if [[ "$first" == false ]]; then printf ','; fi
    emit_instance "$pid" "$catalina_base" "$tomcat_version" "$java_version" "$args_text" "$http_port"
    first=false
  done
}

printf '%s\n' '===TOMCAT_INSPECTION_JSON_BEGIN==='
printf '{"middleware":"tomcat","protocolVersion":'; json_string "$protocol_version"
printf ',"collectorVersion":'; json_string "$collector_version"
printf ',"collectedAt":'; json_string "$collected_at"
printf ',"host":{"hostname":'; json_string "$hostname_value"
printf ',"ip":'; json_string "$host_ip"
printf '},"discovery":'
emit_discovery "${TOMCAT_INSPECTOR_DISCOVERY:-$default_discovery}"
printf ',"instances":['
if [[ -v TOMCAT_INSPECTOR_INSTANCES ]]; then
  emit_instances_from_input "$TOMCAT_INSPECTOR_INSTANCES"
else
  emit_instance "${TOMCAT_INSPECTOR_PID:-1}" "${TOMCAT_INSPECTOR_CATALINA_BASE:-/opt/tomcat}" "${TOMCAT_INSPECTOR_TOMCAT_VERSION:-}" "${TOMCAT_INSPECTOR_JAVA_VERSION:-}" "${TOMCAT_INSPECTOR_JVM_ARGS:-}" "${TOMCAT_INSPECTOR_HTTP_PORT:-8080}"
fi
printf ']}\n'
printf '%s\n' '===TOMCAT_INSPECTION_JSON_END==='
