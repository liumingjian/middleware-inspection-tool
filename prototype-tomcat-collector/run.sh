#!/usr/bin/env bash
set -u
ROOT=$(cd "$(dirname "$0")" && pwd)
COLLECTOR="$ROOT/collect_tomcat.sh"
TMP="$ROOT/.tmp-run"
PASS=0
FAIL=0

rm -rf "$TMP"
mkdir -p "$TMP"
pass() { PASS=$((PASS + 1)); printf 'PASS %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; }
write_cmdline() { local file=$1; shift; : > "$file"; local arg; for arg in "$@"; do printf '%s\0' "$arg" >> "$file"; done; }

setup_multi_fixture() {
  local proc="$TMP/multi/proc" cfg="$TMP/multi/cfg"
  mkdir -p "$proc/101" "$proc/102" "$proc/103" "$proc/104" "$proc/105" "$proc/106"
  mkdir -p "$cfg/opt/tomcat85/base/conf" "$cfg/opt/tomcat85/base/webapps/app" "$cfg/opt/tomcat nine/base/conf" "$cfg/opt/tomcat nine/base/webapps/app one" "$cfg/srv/tomcat10/base/conf" "$cfg/srv/tomcat10/base/webapps/a" "$cfg/srv/tomcat10/base/webapps/b" "$cfg/special/中文 base/conf" "$cfg/special/中文 base/webapps"
  write_cmdline "$proc/101/cmdline" java '-Dcatalina.base=/opt/tomcat85/base' org.apache.catalina.startup.Bootstrap start
  write_cmdline "$proc/102/cmdline" java '-Dcatalina.base=/opt/tomcat nine/base' '-Ddb.password=NeverEmit123' org.apache.catalina.startup.Bootstrap start
  write_cmdline "$proc/103/cmdline" java '-Dcatalina.base=/srv/tomcat10/base' '-Dapi.token=TokenShouldNotAppear' org.apache.catalina.startup.Bootstrap start
  write_cmdline "$proc/104/cmdline" java '-Dcatalina.home=/lost/home' org.apache.catalina.startup.Bootstrap start
  write_cmdline "$proc/105/cmdline" java '-Dcatalina.base=relative/../bad' org.apache.catalina.startup.Bootstrap start
  write_cmdline "$proc/106/cmdline" java '-Dcatalina.base=/special/中文 base' org.apache.catalina.startup.Bootstrap $'line\nbreak'
  printf 'Apache Tomcat Version 8.5.100\nrelease note secret hash abc123\n' > "$cfg/opt/tomcat85/base/RELEASE-NOTES"
  printf 'Apache Tomcat Version 9.0.99\nsecret hash def456\n' > "$cfg/opt/tomcat nine/base/RELEASE-NOTES"
  printf 'Apache Tomcat Version 10.1.20\n' > "$cfg/srv/tomcat10/base/RELEASE-NOTES"
  printf 'Apache Tomcat Version 9.0.特别版 must not leak\n' > "$cfg/special/中文 base/RELEASE-NOTES"
  printf '<Server><Connector password="XmlSecretShouldNotAppear" /></Server>\n' > "$cfg/opt/tomcat85/base/conf/server.xml"
  printf '<Server />\n' > "$cfg/opt/tomcat nine/base/conf/server.xml"
  printf '<Server />\n' > "$cfg/srv/tomcat10/base/conf/server.xml"
  printf '<Server />\n' > "$cfg/special/中文 base/conf/server.xml"
  printf '%s\n' "$proc|$cfg"
}
setup_duplicate_fixture() {
  local proc="$TMP/dup/proc" cfg="$TMP/dup/cfg"
  mkdir -p "$proc/201" "$proc/202" "$cfg/dup/a/conf" "$cfg/dup/b/conf"
  write_cmdline "$proc/201/cmdline" java '-Dcatalina.base=/dup/a' org.apache.catalina.startup.Bootstrap
  write_cmdline "$proc/202/cmdline" java '-Dcatalina.base=/dup/b' org.apache.catalina.startup.Bootstrap
  printf '201\n' > "$proc/202/declared-pid"
  printf 'Apache Tomcat Version 9.0.1\n' > "$cfg/dup/a/RELEASE-NOTES"
  printf 'Apache Tomcat Version 10.1.1\n' > "$cfg/dup/b/RELEASE-NOTES"
  printf '<Server />\n' > "$cfg/dup/a/conf/server.xml"; printf '<Server />\n' > "$cfg/dup/b/conf/server.xml"
  printf '%s\n' "$proc|$cfg"
}
setup_zero_fixture() { local proc="$TMP/zero/proc" cfg="$TMP/zero/cfg"; mkdir -p "$proc/301" "$cfg"; write_cmdline "$proc/301/cmdline" sleep 100; printf '%s\n' "$proc|$cfg"; }
setup_limited_fixture() { local proc="$TMP/limited/proc" cfg="$TMP/limited/cfg"; mkdir -p "$proc/401" "$proc/402" "$cfg"; write_cmdline "$proc/401/cmdline" sleep 100; : > "$proc/402/cmdline"; chmod 000 "$proc/402/cmdline" 2>/dev/null || true; printf '%s\n' "$proc|$cfg"; }

extract_json() {
  python3 - "$1" <<'PY'
import sys
text=open(sys.argv[1], encoding='utf-8').read(); b='=== MIDDLEWARE_INSPECTION_JSON_BEGIN ===\n'; e='\n=== MIDDLEWARE_INSPECTION_JSON_END ==='
assert text.count(b)==1 and text.count(e)==1 and text.startswith(b) and text.endswith(e+'\n')
print(text[text.index(b)+len(b):text.index(e,text.index(b)+len(b))])
PY
}
assert_json() {
  local name=$1 out=$2 py=$3 jsonfile="$out.json"
  if ! extract_json "$out" > "$jsonfile"; then fail "$name markers/extract"; return; fi
  if python3 - "$jsonfile" <<PY
import json,re,sys
text=open(sys.argv[1],encoding='utf-8').read(); data=json.loads(text)
assert set(data)=={'middleware_type','protocol_version','script_version','collected_at','host','discovery','instances','collection_issues'}
assert data['middleware_type']=='tomcat' and data['protocol_version']=='1.0' and data['script_version']=='0.1.0'
assert re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$',data['collected_at'])
assert set(data['host'])=={'hostname'} and set(data['discovery'])=={'coverage','methods'}
assert data['discovery']['coverage'] in {'complete','partial','unknown'}
statuses={'collected','partially_collected','not_collected','not_applicable'}; codes={'permission_denied','hidden_by_procfs','tool_missing','tool_incompatible','config_unreadable','path_not_found','process_exited','unsupported_version','unresolved_reference','parse_error'}; scopes={'batch','host','discovery','instance','field'}
ids=[]
for issue in data['collection_issues']:
    assert set(issue)=={'issue_id','code','scope','subject','message'}
    assert re.match(r'^ci-[0-9]{4}$',issue['issue_id']) and issue['code'] in codes and issue['scope'] in scopes and issue['subject'].startswith('/') and '\n' not in issue['message']
    ids.append(issue['issue_id'])
assert len(ids)==len(set(ids)); issue_set=set(ids); refs=[]
def walk(x):
    if isinstance(x,dict):
        if {'status','source','issue_ids'} <= set(x):
            assert x['status'] in statuses and set(x['source'])=={'kind','locator'} and x['source']['kind'] in {'host','procfs_cmdline','release_notes','config_path','prototype'} and isinstance(x['issue_ids'],list)
            refs.extend(x['issue_ids'])
            if x['status']=='collected': assert 'value' in x and x['issue_ids']==[]
            if x['status']=='not_collected': assert 'value' not in x and x['issue_ids']
            if x['status']=='partially_collected': assert x['issue_ids']
            if x['status']=='not_applicable': assert 'value' not in x and 'applicability_reason' in x
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
walk(data)
for m in data['discovery']['methods']:
    assert m['method']=='procfs_cmdline' and m['status'] in statuses; refs.extend(m['issue_ids'])
for inst in data['instances']:
    assert set(inst) >= {'instance_id','pid','identity','tomcat','jvm','security','logging','connectors','executors','applications','filesystems','collection_issue_ids'}
    assert set(inst) <= {'instance_id','pid','catalina_base','identity','tomcat','jvm','security','logging','connectors','executors','applications','filesystems','collection_issue_ids'}
    assert inst['instance_id']=='pid:%d' % inst['pid']
    assert set(inst['identity'])=={'pid','catalina_base'} and set(inst['tomcat'])=={'version','server_xml'}
    refs.extend(inst['collection_issue_ids'])
assert all(ref in issue_set for ref in refs), (refs, issue_set)
assert set(refs) <= issue_set
assert 'not_applicable' not in text
assert 'null' not in text
for forbidden in ['NeverEmit123','TokenShouldNotAppear','XmlSecretShouldNotAppear','abc123','def456','<Server','password=','api.token','db.password','line\\nbreak','特别版 must not leak']:
    assert forbidden not in text, forbidden
assert '"id"' not in text and '"source":"' not in text
$py
PY
  then pass "$name"; else fail "$name"; fi
}

printf '%s\n' 'Tests use python3 only as JSON parser/assertion oracle; collector itself is Bash-only and does not call jq/python.'
IFS='|' read -r proc cfg < <(setup_multi_fixture); out="$TMP/multi.out"; "$COLLECTOR" --fixture-proc-root "$proc" --fixture-config-root "$cfg" > "$out"
assert_json 'strict shapes versions redaction unicode invalid candidates' "$out" """
assert len(data['instances']) == 6
assert data['discovery']['coverage'] == 'complete'
versions=[i['tomcat']['version'].get('value') for i in data['instances']]
assert '8.5.100' in versions and '9.0.99' in versions and '10.1.20' in versions
assert all(v is None or re.match(r'^[0-9]+\\.[0-9]+(\\.[0-9]+)?$', v) for v in versions)
assert any('catalina_base' not in i for i in data['instances'] if i['pid'] == 104)
assert any('catalina_base' not in i for i in data['instances'] if i['pid'] == 105)
assert '/special/中文 base' in [i.get('catalina_base') for i in data['instances']]
assert len([i for i in data['collection_issues'] if i['code'] == 'unresolved_reference']) == 2
assert any('lacks' in i['message'] for i in data['collection_issues'])
assert any('absolute path' in i['message'] for i in data['collection_issues'])
"""
IFS='|' read -r proc cfg < <(setup_duplicate_fixture); out="$TMP/dup.out"; "$COLLECTOR" --fixture-proc-root "$proc" --fixture-config-root "$cfg" > "$out"
assert_json 'duplicate PID candidates preserved by fixture declared-pid' "$out" """
assert len(data['instances']) == 2
assert [i['pid'] for i in data['instances']] == [201, 201]
assert [i['instance_id'] for i in data['instances']] == ['pid:201', 'pid:201']
assert [i['catalina_base'] for i in data['instances']] == ['/dup/a','/dup/b']
"""
IFS='|' read -r proc cfg < <(setup_zero_fixture); out="$TMP/zero.out"; "$COLLECTOR" --fixture-proc-root "$proc" --fixture-config-root "$cfg" > "$out"
assert_json 'zero candidates is complete discovery without issue' "$out" """
assert data['instances'] == []
assert data['discovery']['coverage'] == 'complete'
assert data['collection_issues'] == []
"""
IFS='|' read -r proc cfg < <(setup_limited_fixture); out="$TMP/limited.out"; "$COLLECTOR" --fixture-proc-root "$proc" --fixture-config-root "$cfg" > "$out"; chmod 600 "$proc/402/cmdline" 2>/dev/null || true
assert_json 'limited proc fixture is partial with zero candidates' "$out" """
assert data['instances'] == []
assert data['discovery']['coverage'] == 'partial'
assert any(i['code'] in {'permission_denied','hidden_by_procfs'} for i in data['collection_issues'])
assert not any('zero' in i['message'].lower() for i in data['collection_issues'])
"""
mkdir -p "$TMP/no-hostname-bin"
ln -sf "$(command -v date)" "$TMP/no-hostname-bin/date"
out="$TMP/no-hostname.out"
PATH="$TMP/no-hostname-bin" /bin/bash "$COLLECTOR" --fixture-proc-root "$TMP/zero/proc" --fixture-config-root "$TMP/zero/cfg" > "$out"
assert_json 'hostname failure is issue-backed without placeholder' "$out" """
host=data['host']['hostname']
assert host['status'] == 'not_collected' and 'value' not in host
assert len(host['issue_ids']) == 1
issue=next(i for i in data['collection_issues'] if i['issue_id'] == host['issue_ids'][0])
assert issue['code'] == 'tool_missing' and issue['scope'] == 'host' and issue['subject'] == '/host/hostname'
assert 'unknown' not in text
"""
if bash -n "$COLLECTOR" "$ROOT/run.sh"; then pass 'bash -n collect_tomcat.sh run.sh'; else fail 'bash -n collect_tomcat.sh run.sh'; fi
if ! grep -Ev '^#' "$COLLECTOR" | grep -Eq '\b(jq|python|python3)\b'; then pass 'collector runtime dependency guard no jq/python'; else fail 'collector runtime dependency guard no jq/python'; fi
if "$COLLECTOR" --fixture-proc-root "$TMP/zero/proc" --fixture-config-root "$TMP/zero/cfg" >/dev/null; then pass 'collector fixture invocation returns 0'; else fail 'collector fixture invocation returns 0'; fi
printf 'SUMMARY PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
