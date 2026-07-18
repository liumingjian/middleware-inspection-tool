# Tomcat Collector Prototype

Throwaway prototype for proving a fixed Bash collector can emit boundary-marked strict JSON without a jq or Python runtime dependency. It is intentionally small and fixture-driven; it is not production collection code.

## One command

```bash
./prototype-tomcat-collector/run.sh
```

`run.sh` is deterministic and non-destructive. It creates temporary fixtures under `prototype-tomcat-collector/.tmp-run`, runs the Bash collector in fixture mode, and uses `python3` only as the test oracle to parse/assert JSON. The collector itself does not call jq, Python, sudo, attach tools, JMX, jcmd, jstack, or jmap.

## Files

- `collect_tomcat.sh` — Bash-only prototype collector.
- `run.sh` — one-command fixture/test runner.
- `fixtures/` and `tests/` — minimal placeholders; generated fixture data lives under `.tmp-run` during `run.sh`.

## Validated by this fixture prototype

- Exact JSON markers, each exactly once and with no text outside the marked JSON block.
- Top-level key set: `middleware_type`, `protocol_version`, `script_version`, `collected_at`, `host`, `discovery`, `instances`, `collection_issues`.
- Fixed values: `middleware_type=tomcat`, `protocol_version=1.0`, `script_version=0.1.0`.
- Collection issues use `issue_id` (`ci-[0-9]{4}`), lowercase protocol-enum `code`, permitted `scope`, JSON Pointer `subject`, and safe `message`; issue ids are unique and references resolve.
- Fact wrappers use `collected`, `partially_collected`, and issue-backed `not_collected` in this prototype; missing paths and unimplemented inspection are never represented as `not_applicable`.
- Fact `source` is structured as `{kind, locator}`; `kind` is restricted to the protocol enum (`procfs`, `command`, `file_metadata`, `parsed_config`, `jvm_argument`, `derived_default`) and locators are safe identifiers/paths, not raw command lines.
- `host` is a fixed object containing fact wrappers; hostname command failure is issue-backed `not_collected` with no placeholder value.
- `discovery` is `{coverage, methods}` with `procfs_cmdline`; fixture zero matches is `coverage=complete` with no collection issue, while an unreadable-proc fixture is `coverage=partial` with zero instances.
- Instance shape keeps fixed domains: `identity`, `tomcat`, `jvm`, `security`, `logging`, empty prototype arrays for `connectors`, `executors`, `applications`, and `filesystems`, plus `collection_issue_ids`; generic fact wrappers are not placed directly in domain arrays.
- Every `instance_id` is exactly `pid:<pid>`; duplicate PID candidates intentionally share that value and JSON Pointer array indexes distinguish their issues. Missing or invalid `catalina.base` candidates are preserved with `instance_id`, `pid`, fixed domains, and issue references; top-level `catalina_base` is omitted rather than emitted as an empty string.
- Valid `catalina.base` must be absolute and must not contain dot segments.
- Fixture-only duplicate PID support: in fixture mode only, a safe `declared-pid` file inside a fake proc candidate directory can override the directory number so two candidate entries can both report PID 201 and `instance_id=pid:201`. Production ignores `declared-pid`.
- Version parsing only emits tight numeric Tomcat version tokens from release notes; fixtures cover 8.5, 9.0, and 10.1.
- Missing and unreadable release notes are checked before redirection, emit no expected-degradation stderr, and map respectively to `path_not_found` and `config_unreadable`; fixture mode uses a safe adjacent `RELEASE-NOTES.fixture-state` marker solely to deterministically simulate unreadability.
- JSON escaping covers fixture hostile ASCII controls and a Chinese UTF-8 path; tests prove the current Bash implementation does not corrupt that Chinese fixture.
- Sensitive fixture values from cmdline/config are forbidden in output, including password/token keys and raw XML.
- Prototype caps candidate scan and issue count deterministically, with a protocol-enum `parse_error` truncation issue when a cap is reached.
- Runtime guard statically asserts the collector source does not invoke jq/python; Python remains test-oracle only.
- `bash -n collect_tomcat.sh run.sh` passes, and collector fixture invocation returns 0.
- The collector also ran without fixture mode against real Linux container `/proc` paths:
  - zero-Tomcat container: strict JSON, `coverage=complete`, no issues;
  - Tomcat 8.5.100 on Java 8: discovered the live process and emitted version `8.5.100`;
  - Tomcat 9.0.89 on Java 8: discovered the live process and emitted version `9.0.89`;
  - Tomcat 10.1.20 on Java 17: discovered the live process and emitted version `10.1.20`.

## Not validated / limitations

- The real Linux checks used same-user processes in disposable containers; they do not complete the permission and namespace matrix.
- A real same-container cross-user path-restriction check discovered the live instance, converted inaccessible config/version facts to issue-backed `not_collected`, and emitted empty stderr. Hidepid and the broader cross-user procfs/container/PID-namespace/network-namespace matrix remain unverified.
- BusyBox/ash compatibility is not validated; the prototype requires Bash.
- Real unreadable config behavior as different users is not validated; the unreadable-proc case is fixture-mode proof only.
- Connector, executor, TLS, realm, logging, application, and filesystem semantic parsing are not implemented; fixed domain arrays remain empty.
- The candidate and issue caps are prototype constants, not capacity planning.
- Unicode coverage is limited to the tested Chinese fixture; arbitrary Unicode normalization/locale matrices remain unverified.

## Prototype contract notes

The collector intentionally avoids nulls, raw command output, ad hoc issue fields, arbitrary release-note lines, raw hashes, secret args, and source strings. It preserves candidate rows for validation instead of silently dropping malformed Tomcat-like processes.
