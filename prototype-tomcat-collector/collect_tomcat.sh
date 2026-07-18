#!/usr/bin/env bash
# PROTOTYPE: throwaway Tomcat collector proving strict JSON boundaries without jq/Python.
set -u

BEGIN_MARKER='=== MIDDLEWARE_INSPECTION_JSON_BEGIN ==='
END_MARKER='=== MIDDLEWARE_INSPECTION_JSON_END ==='
SCRIPT_VERSION='0.1.0'

PROC_ROOT='/proc'
CONFIG_ROOT=''
FIXTURE_MODE=0
MAX_CANDIDATES=6
MAX_ISSUES=20
ISSUE_SEQ=0
ISSUE_LIMIT_REPORTED=0
ADDED_ISSUE_ID=''

usage() {
  printf 'Usage: %s [--fixture-proc-root DIR --fixture-config-root DIR]\n' "$0" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --fixture-proc-root)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      PROC_ROOT=$2
      FIXTURE_MODE=1
      shift 2
      ;;
    --fixture-config-root)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      CONFIG_ROOT=$2
      FIXTURE_MODE=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ "$FIXTURE_MODE" -ne 1 ] && [ "$(uname -s 2>/dev/null || printf unknown)" != "Linux" ]; then
  printf 'ERROR: collect_tomcat.sh must run on Linux unless fixture mode is used.\n' >&2
  exit 1
fi


json_escape() {
  local s=${1-} out='' prefix suffix c
  while [ -n "$s" ]; do
    prefix=${s%%[$'"\\\b\f\n\r\t']*}
    out+=$prefix
    s=${s#"$prefix"}
    [ -n "$s" ] || break
    c=${s:0:1}
    case "$c" in
      '"') out+='\\"' ;;
      '\\') out+='\\\\' ;;
      $'\b') out+='\\b' ;;
      $'\f') out+='\\f' ;;
      $'\n') out+='\\n' ;;
      $'\r') out+='\\r' ;;
      $'\t') out+='\\t' ;;
    esac
    s=${s:1}
  done
  printf '%s' "$out"
}
jstr() { printf '"%s"' "$(json_escape "$1")"; }

source_obj() {
  printf '{"kind":'; jstr "$1"; printf ',"locator":'; jstr "$2"; printf '}'
}

fact() {
  local status=$1 value=$2 kind=$3 locator=$4 ids=${5-}
  printf '{"status":'; jstr "$status"
  case "$status" in
    collected|partially_collected) printf ',"value":'; jstr "$value" ;;
  esac
  printf ',"source":'; source_obj "$kind" "$locator"
  printf ',"issue_ids":['
  if [ -n "$ids" ]; then
    local oldifs=$IFS first=1 id
    IFS=','
    for id in $ids; do
      [ -n "$id" ] || continue
      [ "$first" -eq 1 ] || printf ','
      jstr "$id"
      first=0
    done
    IFS=$oldifs
  fi
  printf ']}'
}

COLLECTION_ISSUES=()
INSTANCES=()

issue_obj() {
  printf '{"issue_id":'; jstr "$1"
  printf ',"code":'; jstr "$2"
  printf ',"scope":'; jstr "$3"
  printf ',"subject":'; jstr "$4"
  printf ',"message":'; jstr "$5"
  printf '}'
}

add_issue() {
  local code=$1 scope=$2 subject=$3 message=$4 id
  if [ "${#COLLECTION_ISSUES[@]}" -ge "$MAX_ISSUES" ]; then
    if [ "$ISSUE_LIMIT_REPORTED" -eq 0 ]; then
      ISSUE_LIMIT_REPORTED=1
      COLLECTION_ISSUES[$((MAX_ISSUES - 1))]=$(issue_obj 'ci-9999' 'parse_error' 'batch' '/collection_issues' 'Issue output was truncated at the prototype limit')
      ADDED_ISSUE_ID='ci-9999'
    fi
    return 0
  fi
  ISSUE_SEQ=$((ISSUE_SEQ + 1))
  printf -v id 'ci-%04d' "$ISSUE_SEQ"
  COLLECTION_ISSUES+=("$(issue_obj "$id" "$code" "$scope" "$subject" "$message")")
  ADDED_ISSUE_ID=$id
}

csv_append() {
  local csv=$1 id=$2
  if [ -z "$id" ]; then printf '%s' "$csv"; elif [ -z "$csv" ]; then printf '%s' "$id"; else printf '%s,%s' "$csv" "$id"; fi
}

read_file_text() {
  local path=$1 data
  [ -e "$path" ] || return 1
  [ -r "$path" ] || return 2
  data=$(<"$path") || return 2
  printf '%s' "$data"
}

safe_config_path() {
  local base=$1 rel=$2
  if [ -n "$CONFIG_ROOT" ]; then
    printf '%s%s/%s' "$CONFIG_ROOT" "$base" "$rel"
  else
    printf '%s/%s' "$base" "$rel"
  fi
}

extract_arg_value() {
  local key=$1; shift
  local a next=0
  for a in "$@"; do
    if [ "$next" -eq 1 ]; then printf '%s' "$a"; return 0; fi
    case "$a" in
      "$key"=*) printf '%s' "${a#*=}"; return 0 ;;
      "$key") next=1 ;;
    esac
  done
  return 1
}

has_tomcat_marker() {
  local a
  for a in "$@"; do
    case "$a" in
      *org.apache.catalina.startup.Bootstrap*|*catalina.base*|*catalina.home*) return 0 ;;
    esac
  done
  return 1
}

valid_abs_path() {
  local p=$1
  case "$p" in
    /*) ;;
    *) return 1 ;;
  esac
  case "$p" in
    */../*|*/./*|*/..|*/.|/..|/.) return 1 ;;
  esac
  return 0
}

version_from_release_notes() {
  local base=$1 line path fixture_state
  path=$(safe_config_path "$base" 'RELEASE-NOTES')
  if [ "$FIXTURE_MODE" -eq 1 ] && [ -r "$path.fixture-state" ]; then
    fixture_state=$(read_file_text "$path.fixture-state" || true)
    [ "$fixture_state" != 'unreadable' ] || return 2
  fi
  [ -e "$path" ] || return 1
  [ -r "$path" ] || return 2
  while IFS= read -r line; do
    case "$line" in
      *Apache\ Tomcat\ Version*)
        if [[ $line =~ Apache[[:space:]]+Tomcat[[:space:]]+Version[[:space:]]+([0-9]+\.[0-9]+(\.[0-9]+)?) ]]; then
          printf '%s' "${BASH_REMATCH[1]}"
          return 0
        fi
        ;;
    esac
  done < "$path" 2>/dev/null || return 2
  return 3
}

server_xml_state() {
  local base=$1 path
  path=$(safe_config_path "$base" 'conf/server.xml')
  read_file_text "$path" >/dev/null
  case $? in
    0) printf 'present' ;;
    1) printf 'missing' ;;
    *) printf 'unreadable' ;;
  esac
}

app_count() {
  local base=$1 dir count=0 entry
  dir=$(safe_config_path "$base" 'webapps')
  if [ -d "$dir" ]; then
    for entry in "$dir"/*; do
      [ -e "$entry" ] || continue
      count=$((count + 1))
    done
    printf '%s' "$count"
  else
    printf 'unavailable'
  fi
}

fixture_declared_pid() {
  local pdir=$1 pid=$2 declared
  if [ "$FIXTURE_MODE" -eq 1 ] && [ -r "$pdir/declared-pid" ]; then
    declared=$(read_file_text "$pdir/declared-pid" || true)
    case "$declared" in *[!0-9]*|'') printf '%s' "$pid" ;; *) printf '%s' "$declared" ;; esac
  else
    printf '%s' "$pid"
  fi
}

emit_instance() {
  local pid=$1 candidate_no=$2 base=$3 home=$4 pdir=$5
  local base_issue='' version_issue='' sx_issue='' apps_issue='' logging_issue='' version sx apps id_csv='' base_status base_value version_status sx_status apps_status
  local catalina_base_json=''

  if [ -z "$base" ]; then
    add_issue 'unresolved_reference' 'instance' "/instances/$((candidate_no - 1))/identity/catalina_base" 'Tomcat-like candidate lacks an allowlisted catalina.base argument'; base_issue=$ADDED_ISSUE_ID
    id_csv=$(csv_append "$id_csv" "$base_issue")
    base_status='not_collected'
    base_value=''
  elif ! valid_abs_path "$base"; then
    add_issue 'unresolved_reference' 'instance' "/instances/$((candidate_no - 1))/identity/catalina_base" 'catalina.base is not an absolute path without dot segments'; base_issue=$ADDED_ISSUE_ID
    id_csv=$(csv_append "$id_csv" "$base_issue")
    base_status='not_collected'
    base_value=''
  else
    base_status='collected'
    base_value=$base
    catalina_base_json=',"catalina_base":'; catalina_base_json+=$(jstr "$base")
  fi

  if [ "$base_status" = 'collected' ]; then
    version=$(version_from_release_notes "$base")
    version_rc=$?
    if [ "$version_rc" -eq 0 ] && [ -n "$version" ]; then
      version_status='collected'
    else
      case "$version_rc" in
        1) version_code='path_not_found'; version_message='Tomcat version release notes were not found' ;;
        2) version_code='config_unreadable'; version_message='Tomcat version release notes could not be read' ;;
        *) version_code='parse_error'; version_message='Tomcat version token could not be parsed from release notes' ;;
      esac
      add_issue "$version_code" 'field' "/instances/$((candidate_no - 1))/tomcat/version" "$version_message"
      version_issue=$ADDED_ISSUE_ID
      version_status='not_collected'
      version=''
    fi
    sx=$(server_xml_state "$base")
    if [ "$sx" = 'present' ]; then
      sx_status='collected'
    else
      add_issue "$([ "$sx" = missing ] && printf path_not_found || printf config_unreadable)" 'field' "/instances/$((candidate_no - 1))/tomcat/server_xml" "server.xml is $sx"; sx_issue=$ADDED_ISSUE_ID
      sx_status='not_collected'
    fi
    apps=$(app_count "$base")
    if [ "$apps" = 'unavailable' ]; then add_issue 'path_not_found' 'field' "/instances/$((candidate_no - 1))/applications" 'Tomcat webapps directory was not found'; apps_issue=$ADDED_ISSUE_ID; apps_status='not_collected'; else apps_status='collected'; fi
  else
    version_status='not_collected'; version=''; version_issue=$base_issue
    sx=''; sx_status='not_collected'; sx_issue=$base_issue
    apps=''; apps_status='not_collected'; apps_issue=$base_issue
  fi

  add_issue 'tool_missing' 'field' "/instances/$((candidate_no - 1))/logging/configuration" 'Logging inspection is not implemented by this prototype'
  logging_issue=$ADDED_ISSUE_ID

  EMITTED_INSTANCE=''
  EMITTED_INSTANCE+='{"instance_id":"pid:'; EMITTED_INSTANCE+=$pid
  EMITTED_INSTANCE+='","pid":'; EMITTED_INSTANCE+="$pid"; EMITTED_INSTANCE+="$catalina_base_json"
  EMITTED_INSTANCE+=',"identity":{"pid":'; EMITTED_INSTANCE+="$pid"; EMITTED_INSTANCE+=',"catalina_base":'
  EMITTED_INSTANCE+=$(fact "$base_status" "$base_value" 'procfs' "/proc/$pid/cmdline" "$id_csv")
  EMITTED_INSTANCE+='},"tomcat":{"version":'
  EMITTED_INSTANCE+=$(fact "$version_status" "$version" 'parsed_config' 'RELEASE-NOTES version token' "$version_issue")
  EMITTED_INSTANCE+=',"server_xml":'
  EMITTED_INSTANCE+=$(fact "$sx_status" "$sx" 'file_metadata' 'conf/server.xml' "$sx_issue")
  EMITTED_INSTANCE+='},"jvm":{"runtime_args":'
  EMITTED_INSTANCE+=$(fact 'collected' 'sensitive runtime arguments excluded' 'procfs' "/proc/$pid/cmdline" '')
  EMITTED_INSTANCE+='},"security":{"cmdline_redaction":'
  EMITTED_INSTANCE+=$(fact 'collected' 'raw cmdline values redacted' 'procfs' "/proc/$pid/cmdline" '')
  EMITTED_INSTANCE+='},"logging":{"configuration":'
  EMITTED_INSTANCE+=$(fact 'not_collected' '' 'command' 'logging inspection unavailable' "$logging_issue")
  EMITTED_INSTANCE+='},"connectors":[],"executors":[],"applications":[],"filesystems":[],"collection_issue_ids":['
  local first=1 iid
  local all_ids=$id_csv
  all_ids=$(csv_append "$all_ids" "$version_issue")
  all_ids=$(csv_append "$all_ids" "$sx_issue")
  all_ids=$(csv_append "$all_ids" "$apps_issue")
  all_ids=$(csv_append "$all_ids" "$logging_issue")
  local oldifs=$IFS
  IFS=','
  for iid in $all_ids; do
    [ -n "$iid" ] || continue
    [ "$first" -eq 1 ] || EMITTED_INSTANCE+=','
    EMITTED_INSTANCE+=$(jstr "$iid")
    first=0
  done
  IFS=$oldifs
  EMITTED_INSTANCE+=']}'
}

PROC_LIMIT=0
CANDIDATE_SCAN_TRUNCATED=0
DISCOVERY_CANDIDATES=0

if [ ! -d "$PROC_ROOT" ]; then
  add_issue 'path_not_found' 'discovery' '/discovery/methods/0' 'proc root is missing or inaccessible'
  PROC_LIMIT=1
else
  for pdir in "$PROC_ROOT"/[0-9]*; do
    [ -e "$pdir" ] || continue
    dir_pid=${pdir##*/}
    case "$dir_pid" in *[!0-9]*|'') continue ;; esac
    cmdline_file="$pdir/cmdline"
    if [ ! -r "$cmdline_file" ]; then
      add_issue 'permission_denied' 'discovery' '/discovery/methods/0' 'one proc cmdline could not be inspected'
      PROC_LIMIT=1
      continue
    fi
    args=()
    while IFS= read -r -d '' arg; do args+=("$arg"); done < "$cmdline_file"
    [ "${#args[@]}" -gt 0 ] || continue
    has_tomcat_marker "${args[@]}" || continue
    if [ "$DISCOVERY_CANDIDATES" -ge "$MAX_CANDIDATES" ]; then
      CANDIDATE_SCAN_TRUNCATED=1
      continue
    fi
    DISCOVERY_CANDIDATES=$((DISCOVERY_CANDIDATES + 1))
    base=$(extract_arg_value '-Dcatalina.base' "${args[@]}" || true)
    home=$(extract_arg_value '-Dcatalina.home' "${args[@]}" || true)
    pid=$(fixture_declared_pid "$pdir" "$dir_pid")
    emit_instance "$pid" "$DISCOVERY_CANDIDATES" "$base" "$home" "$pdir"
    INSTANCES+=("$EMITTED_INSTANCE")
  done
fi

if [ "$CANDIDATE_SCAN_TRUNCATED" -eq 1 ]; then
  add_issue 'parse_error' 'discovery' '/instances' 'candidate scan was truncated at the prototype limit'
fi
if [ "$PROC_LIMIT" -eq 1 ]; then
  add_issue 'hidden_by_procfs' 'discovery' '/discovery/methods/0' 'one or more proc entries could not be inspected'
fi

collected_at=$(date +%Y-%m-%dT%H:%M:%S%z)
collected_at=${collected_at:0:22}:${collected_at:22:2}
host_status='collected'
host_name=''
host_issue=''
if ! host_name=$(hostname 2>/dev/null) || [ -z "$host_name" ]; then
  add_issue 'tool_missing' 'host' '/host/hostname' 'Hostname could not be collected'
  host_issue=$ADDED_ISSUE_ID
  host_status='not_collected'
fi

if [ "$PROC_LIMIT" -eq 1 ] || [ "$CANDIDATE_SCAN_TRUNCATED" -eq 1 ]; then
  coverage='partial'
else
  coverage='complete'
fi
method_status='collected'
method_issue_ids=''
if [ "$PROC_LIMIT" -eq 1 ] || [ "$CANDIDATE_SCAN_TRUNCATED" -eq 1 ]; then
  method_status='partially_collected'
  for item in "${COLLECTION_ISSUES[@]}"; do
    case "$item" in
      *'"scope":"discovery"'*)
        iid=${item#*'"issue_id":"'}; iid=${iid%%\"*}
        method_issue_ids=$(csv_append "$method_issue_ids" "$iid")
        ;;
    esac
  done
fi

printf '%s\n' "$BEGIN_MARKER"
printf '{'
printf '"middleware_type":"tomcat",'
printf '"protocol_version":"1.0",'
printf '"script_version":"%s",' "$SCRIPT_VERSION"
printf '"collected_at":"%s",' "$collected_at"
printf '"host":{"hostname":'; fact "$host_status" "$host_name" 'command' 'hostname' "$host_issue"; printf '},'
printf '"discovery":{"coverage":"%s","methods":[{"method":"procfs_cmdline","status":"%s","issue_ids":[' "$coverage" "$method_status"
oldifs=$IFS; IFS=','; first=1
for iid in $method_issue_ids; do [ -n "$iid" ] || continue; [ "$first" -eq 1 ] || printf ','; jstr "$iid"; first=0; done
IFS=$oldifs
printf ']}]},'
printf '"instances":['
for i in "${!INSTANCES[@]}"; do
  [ "$i" -eq 0 ] || printf ','
  printf '%s' "${INSTANCES[$i]}"
done
printf '],"collection_issues":['
for i in "${!COLLECTION_ISSUES[@]}"; do
  [ "$i" -eq 0 ] || printf ','
  printf '%s' "${COLLECTION_ISSUES[$i]}"
done
printf ']}'
printf '\n%s\n' "$END_MARKER"
