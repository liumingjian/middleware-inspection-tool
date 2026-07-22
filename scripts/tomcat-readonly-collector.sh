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

redact_jvm_arg() {
  local arg="$1" lower="${1,,}"
  if [[ "$lower" == *=* && "$lower" =~ (password|passwd|secret|token|cookie|authorization|credential|keystorepass|keypass|apikey|api-key|accesskey|access-key|jdbc:) ]]; then
    printf '%s=[REDACTED]' "${arg%%=*}"
  else
    printf '%s' "$arg"
  fi
}

json_args() {
  local args_text="$1" arg safe_arg first=true
  local -a args=()
  read -r -a args <<< "$args_text"
  printf '['
  for arg in "${args[@]}"; do
    if [[ "$first" == false ]]; then printf ','; fi
    safe_arg=$(redact_jvm_arg "$arg")
    json_string "$safe_arg"
    first=false
  done
  printf ']'
}

collect_disk_fact() {
  command -v df >/dev/null 2>&1 || return 2
  local line blocks available used mount
  line=$(df -Pk /opt 2>/dev/null | tail -n 1) || return 1
  read -r _ blocks _ available used mount <<< "$line"
  [[ "$blocks" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ && "$used" =~ ^[0-9]+%$ ]] || return 3
  printf '%s|%s|%s|%s' "$mount" "$((blocks * 1024))" "$((available * 1024))" "${used%%%}"
}

collect_inode_fact() {
  command -v df >/dev/null 2>&1 || return 2
  local line total available used mount
  line=$(df -Pi /opt 2>/dev/null | tail -n 1) || return 1
  read -r _ total _ available used mount <<< "$line"
  [[ "$total" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ && "$used" =~ ^[0-9]+%$ ]] || return 3
  printf '%s|%s|%s|%s' "$mount" "$total" "$available" "${used%%%}"
}

collect_memory_fact() {
  [[ -r /proc/meminfo ]] || return 1
  local total_kb available_kb used_percent
  total_kb=$(grep '^MemTotal:' /proc/meminfo | tr -cd '0-9')
  available_kb=$(grep '^MemAvailable:' /proc/meminfo | tr -cd '0-9')
  [[ "$total_kb" =~ ^[0-9]+$ && "$available_kb" =~ ^[0-9]+$ && "$total_kb" -gt 0 ]] || return 3
  used_percent=$(( (total_kb - available_kb) * 100 / total_kb ))
  printf '%s|%s|%s' "$((total_kb * 1024))" "$((available_kb * 1024))" "$used_percent"
}

resolve_fact() {
  local kind="$1" value_variable="TOMCAT_INSPECTOR_${1^^}_FACT" status_variable="TOMCAT_INSPECTOR_${1^^}_STATUS"
  local value="${!value_variable:-}" status="${!status_variable:-}" rc=0
  if [[ -z "$status" && -z "$value" ]]; then
    value=$("collect_${kind}_fact") || rc=$?
    case "$rc" in 0) status=success ;; 1) status=restricted ;; 2) status=unavailable ;; *) status=unreliable ;; esac
  elif [[ -z "$status" ]]; then
    status=success
  fi
  printf '%s\n%s' "$status" "$value"
}

emit_capacity_fact() {
  local kind="$1" status="$2" source="$3" unit="$4" value="$5"
  local mount total available used_percent
  printf '{"status":'; json_string "$status"
  printf ',"source":'; json_string "$source"
  printf ',"unit":'; json_string "$unit"
  if [[ "$status" == success && -n "$value" ]]; then
    if [[ "$kind" == memory ]]; then
      IFS='|' read -r total available used_percent <<< "$value"
    else
      IFS='|' read -r mount total available used_percent <<< "$value"
      printf ',"mount":'; json_string "$mount"
    fi
    printf ',"total":%s,"available":%s,"usedPercent":%s' "$total" "$available" "$used_percent"
  fi
  printf '}'
}

resolve_cpu_count() {
  local cpu_count="${TOMCAT_INSPECTOR_CPU_COUNT:-}"
  if [[ -z "$cpu_count" ]] && command -v getconf >/dev/null 2>&1; then
    cpu_count=$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)
  fi
  if [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s' "$cpu_count"
  fi
}

emit_host_resources() {
  local disk_result inode_result memory_result disk_status inode_status memory_status
  local disk_value inode_value memory_value
  disk_result=$(resolve_fact disk); disk_status=${disk_result%%$'\n'*}; disk_value=${disk_result#*$'\n'}
  inode_result=$(resolve_fact inode); inode_status=${inode_result%%$'\n'*}; inode_value=${inode_result#*$'\n'}
  memory_result=$(resolve_fact memory); memory_status=${memory_result%%$'\n'*}; memory_value=${memory_result#*$'\n'}
  printf '{"disk":'; emit_capacity_fact disk "$disk_status" 'df -Pk /opt' bytes "$disk_value"
  printf ',"inode":'; emit_capacity_fact inode "$inode_status" 'df -Pi /opt' inodes "$inode_value"
  printf ',"memory":'; emit_capacity_fact memory "$memory_status" '/proc/meminfo:MemAvailable' bytes "$memory_value"
  printf '}'
}

emit_observations() {
  local first=true id unit value variable
  printf '['
  for variable in CPU LOAD PROCESS_MEMORY; do
    case "$variable" in
      CPU) id='host.cpu.instantaneous'; unit='percent' ;;
      LOAD) id='host.load.instantaneous'; unit='load' ;;
      PROCESS_MEMORY) id='host.process-memory.instantaneous'; unit='bytes' ;;
    esac
    value="$(eval "printf '%s' \"\${TOMCAT_INSPECTOR_${variable}_OBSERVATION:-}\"")"
    [[ -z "$value" ]] && continue
    if [[ "$first" == false ]]; then printf ','; fi
    printf '{"id":'; json_string "$id"
    printf ',"status":"success","source":"snapshot","unit":'; json_string "$unit"
    printf ',"value":%s}' "$value"
    first=false
  done
  printf ']'
}

emit_value_fact() {
  local value="$1" source="$2"
  printf '{"value":%s,"source":' "$value"; json_string "$source"; printf '}'
}

emit_connectors() {
  local entry status evidence protocol port port_source executor max_threads max_threads_source accept_count accept_count_source timeout timeout_source first=true
  printf '['
  IFS=';' read -r -a entries <<< "${TOMCAT_INSPECTOR_CONNECTORS:-}"
  for entry in "${entries[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r status evidence protocol port port_source executor max_threads max_threads_source accept_count accept_count_source timeout timeout_source <<< "$entry"
    if [[ "$first" == false ]]; then printf ','; fi
    printf '{"status":'; json_string "$status"
    printf ',"evidence":'; json_string "$evidence"
    if [[ "$status" == success ]]; then
      printf ',"protocolHandler":'; json_string "$protocol"
      printf ',"port":'; emit_value_fact "$port" "$port_source"
      printf ',"executor":'; json_string "$executor"
      printf ',"maxThreads":'; emit_value_fact "$max_threads" "$max_threads_source"
      printf ',"acceptCount":'; emit_value_fact "$accept_count" "$accept_count_source"
      printf ',"connectionTimeout":'; emit_value_fact "$timeout" "$timeout_source"
    fi
    printf '}'
    first=false
  done
  printf ']'
}

emit_security_config() {
  local status="${TOMCAT_INSPECTOR_SECURITY_STATUS:-unavailable}"
  printf '{"status":'; json_string "$status"
  printf ',"source":"local-static-config"'
  if [[ "$status" == success ]]; then
    printf ',"directoryListingEnabled":%s' "${TOMCAT_INSPECTOR_DIRECTORY_LISTING_ENABLED:-null}"
    printf ',"autoDeployEnabled":%s' "${TOMCAT_INSPECTOR_AUTO_DEPLOY_ENABLED:-null}"
    printf ',"serverInfoExposed":%s' "${TOMCAT_INSPECTOR_SERVER_INFO_EXPOSED:-null}"
    printf ',"shutdownPort":%s' "${TOMCAT_INSPECTOR_SHUTDOWN_PORT:-null}"
    printf ',"tlsConnectorPresent":%s' "${TOMCAT_INSPECTOR_TLS_CONNECTOR_PRESENT:-null}"
  fi
  printf '}'
}

emit_deployments() {
  local entry status source application_name deployment_path deployment_type context_path reloadable deploy_on_startup unpack_wars first=true
  printf '['
  IFS=';' read -r -a entries <<< "${TOMCAT_INSPECTOR_DEPLOYMENTS:-}"
  for entry in "${entries[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r status source application_name deployment_path deployment_type context_path reloadable deploy_on_startup unpack_wars <<< "$entry"
    if [[ "$first" == false ]]; then printf ','; fi
    printf '{"status":'; json_string "$status"
    printf ',"source":'; json_string "$source"
    if [[ "$status" == success ]]; then
      printf ',"applicationName":'; json_string "$application_name"
      printf ',"deploymentPath":'; json_string "$deployment_path"
      printf ',"deploymentType":'; json_string "$deployment_type"
      printf ',"containerConfig":{"contextPath":'; json_string "$context_path"
      printf ',"reloadable":%s,"deployOnStartup":%s,"unpackWARs":%s}' "$reloadable" "$deploy_on_startup" "$unpack_wars"
    fi
    printf '}'
    first=false
  done
  printf ']'
}

emit_log_targets() {
  local entry id config_status config_source target_path metadata_status metadata_source file_type size_bytes modified_at first=true
  printf '['
  IFS=';' read -r -a entries <<< "${TOMCAT_INSPECTOR_LOG_TARGETS:-}"
  for entry in "${entries[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r id config_status config_source target_path metadata_status metadata_source file_type size_bytes modified_at <<< "$entry"
    if [[ "$first" == false ]]; then printf ','; fi
    printf '{"id":'; json_string "$id"
    printf ',"configuration":{"status":'; json_string "$config_status"
    printf ',"source":'; json_string "$config_source"
    if [[ "$config_status" == success ]]; then printf ',"targetPath":'; json_string "$target_path"; fi
    printf '},"fileMetadata":{"status":'; json_string "$metadata_status"
    printf ',"source":'; json_string "$metadata_source"
    if [[ "$metadata_status" == success ]]; then
      printf ',"fileType":'; json_string "$file_type"
      printf ',"sizeBytes":%s,"modifiedAt":' "$size_bytes"; json_string "$modified_at"
    fi
    printf '}}'
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
  printf '} ,"connectors":'; emit_connectors
  printf ',"securityConfig":'; emit_security_config
  printf ',"deployments":'; emit_deployments
  printf ',"logTargets":'; emit_log_targets
  printf ',"httpPort":%s,"checks":[' "$http_port"
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
cpu_count=$(resolve_cpu_count)
if [[ -n "$cpu_count" ]]; then printf ',"cpuCount":%s' "$cpu_count"; fi
printf ',"resources":'; emit_host_resources
printf ',"observations":'; emit_observations
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
