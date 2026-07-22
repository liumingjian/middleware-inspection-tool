#!/usr/bin/env bash
set -euo pipefail

collector_version="tomcat-readonly-collector/0.1.0"
protocol_version="tomcat-inspection-log/v1"
collected_at="${TOMCAT_INSPECTOR_FIXED_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
hostname_value="${TOMCAT_INSPECTOR_HOSTNAME:-$(hostname 2>/dev/null || printf unknown-host)}"
host_ip="${TOMCAT_INSPECTOR_HOST_IP:-127.0.0.1}"

export collector_version protocol_version collected_at hostname_value host_ip
python3 <<'PY'
import json
import os
import shlex


def jvm_startup(args_text):
    args = shlex.split(args_text)
    facts = {"xms": "", "xmx": "", "gc": "", "gcLog": ""}
    for arg in args:
        if arg.startswith("-Xms"):
            facts["xms"] = arg[4:]
        elif arg.startswith("-Xmx"):
            facts["xmx"] = arg[4:]
        elif arg.startswith("-XX:+Use") and arg.endswith("GC"):
            facts["gc"] = arg[len("-XX:+Use"):-len("GC")] + "GC"
        elif arg.startswith("-Xlog:") and "file=" in arg:
            facts["gcLog"] = arg.split("file=", 1)[1].split(":", 1)[0]
    return {
        "source": "TOMCAT_INSPECTOR_JVM_ARGS" if args_text else "",
        "trusted": bool(args_text),
        "args": args,
        **facts,
    }


def instance(pid, catalina_base, tomcat_version, java_version, args_text, http_port):
    startup = jvm_startup(args_text)
    instance_id = f"{os.environ['host_ip']}:{pid}"
    return {
        "instanceId": instance_id,
        "pid": int(pid),
        "catalinaBase": catalina_base,
        "tomcatVersion": tomcat_version,
        "javaVersion": java_version,
        "jvmStartup": startup,
        "httpPort": int(http_port),
        "checks": [
            {"id": "tomcat.instance.identity.present", "observedValue": instance_id, "evidence": "TOMCAT_INSPECTOR_PID,TOMCAT_INSPECTOR_CATALINA_BASE"},
            {"id": "tomcat.version.support", "observedValue": tomcat_version, "evidence": "TOMCAT_INSPECTOR_TOMCAT_VERSION"},
            {"id": "tomcat.java.version.present", "observedValue": java_version, "evidence": "TOMCAT_INSPECTOR_JAVA_VERSION"},
            {"id": "tomcat.jvm.xms.present", "observedValue": startup["xms"], "evidence": "TOMCAT_INSPECTOR_JVM_ARGS"},
            {"id": "tomcat.jvm.xmx.present", "observedValue": startup["xmx"], "evidence": "TOMCAT_INSPECTOR_JVM_ARGS"},
            {"id": "tomcat.jvm.gc.present", "observedValue": startup["gc"], "evidence": "TOMCAT_INSPECTOR_JVM_ARGS"},
            {"id": "tomcat.jvm.gc-log.present", "observedValue": startup["gcLog"], "evidence": "TOMCAT_INSPECTOR_JVM_ARGS"},
            {"id": "tomcat.http.port.present", "observedValue": int(http_port), "evidence": "TOMCAT_INSPECTOR_HTTP_PORT"},
        ],
    }


def parse_discovery(value):
    results = []
    for entry in filter(None, value.split(";")):
        method, status, detail = entry.split(":", 2)
        results.append({"method": method, "status": status, "detail": detail})
    return results


if "TOMCAT_INSPECTOR_INSTANCES" in os.environ:
    instances = []
    for entry in filter(None, os.environ["TOMCAT_INSPECTOR_INSTANCES"].split(";")):
        instances.append(instance(*entry.split("|", 5)))
else:
    instances = [instance(
        os.environ.get("TOMCAT_INSPECTOR_PID", "1"),
        os.environ.get("TOMCAT_INSPECTOR_CATALINA_BASE", "/opt/tomcat"),
        os.environ.get("TOMCAT_INSPECTOR_TOMCAT_VERSION", ""),
        os.environ.get("TOMCAT_INSPECTOR_JAVA_VERSION", ""),
        os.environ.get("TOMCAT_INSPECTOR_JVM_ARGS", ""),
        os.environ.get("TOMCAT_INSPECTOR_HTTP_PORT", "8080"),
    )]

document = {
    "middleware": "tomcat",
    "protocolVersion": os.environ["protocol_version"],
    "collectorVersion": os.environ["collector_version"],
    "collectedAt": os.environ["collected_at"],
    "host": {"hostname": os.environ["hostname_value"], "ip": os.environ["host_ip"]},
    "discovery": parse_discovery(os.environ.get("TOMCAT_INSPECTOR_DISCOVERY", "configured-input:success:按显式采集参数发现实例")),
    "instances": instances,
}
print("===TOMCAT_INSPECTION_JSON_BEGIN===")
print(json.dumps(document, ensure_ascii=False, separators=(",", ":")))
print("===TOMCAT_INSPECTION_JSON_END===")
PY
