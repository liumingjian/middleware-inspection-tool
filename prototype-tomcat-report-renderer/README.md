# THROWAWAY PROTOTYPE: Tomcat report renderer

This directory is a throwaway prototype for Wayfinder issue “原型验证 Tomcat 报告内容与双格式渲染”. It answers one concrete question:

> Can a typed Tomcat `ReportView` generate deterministic system Markdown, allow a deliberately small editable Markdown subset, and export revised Markdown to DOCX without silently dropping unsupported content or re-evaluating business conclusions?

## One command

```sh
./run.sh
```

`run.sh` works from any current working directory. It recreates `.tmp-run/` deterministically and runs all prototype scenarios/tests.

## Validated product decisions

The tests prove these decisions in generated Markdown and DOCX:

- One valid Tomcat instance produces one report; there is no host/cluster aggregate report.
- Fixed major sections appear in order: 报告说明, 实例概况, 结论摘要, 六巡检域, 无法判断与采集限制, 附录.
- The six inspection domains are fixed and ordered: 主机资源, Tomcat 实例与 JVM, Connector 与线程池, Tomcat 配置安全, 应用部署, 日志配置与文件状态.
- The representative fixtures use exact canonical rule IDs and reason semantics from issue #5: supported 9.0/10.1 normal lifecycle, deterministic degraded warning/abnormal/undetermined results, and a true no-AJP `not_applicable` result.
- Structured rule rows retain `subject`, ordered `reason_codes`, `fact_refs`, `related_subjects`, `evidence_limitations`, `recommendation_ids`, and `verification_ids`. Tests enforce remediation only for warning/abnormal and verification only for undetermined.
- Summary counts keep normal/warning/abnormal/undetermined/not_applicable separate and render them as 正常、警告、异常、无法判断、不适用. No overall risk, rating, or score is rendered.
- CPU/load, heap/thread, application-count, and log-size facts are observations, rendered as non-judgmental notes and excluded from rule counts.
- Only discovery and host visibility/memory results are referenced as shared; instance/domain rules cite direct JSON Pointer fact references.
- Initial `ReportView.user_revised` is always false and identifies the immutable system view. The revised marker comes from the revised Markdown/export request; user-edited Markdown visibly says user revised.
- Final DOCX is rendered from revised Markdown, not from `ReportView`, and includes a visible revised marker.
- Export validation checks only complete Markdown-to-DOCX convertibility. It rejects unsupported/unconvertible content before writing DOCX and does not recalculate rule conclusions.
- Tests compare an ordered normalized Markdown/DOCX block representation and inspect XML order to prove tables remain immediately after their intended headings.
- The report states it is based on a one-time config/status snapshot and does not replace continuous monitoring, performance testing, or diagnosis.
- Sensitive boundaries are preserved: fixtures contain no secrets/raw configs/log body/raw commands; validation errors cite only line/construct, not unsafe content.

## Markdown subset for user edits

Supported:

- ATX headings only, levels `#`, `##`, `###`; heading levels must be in allowed prototype order.
- Paragraphs.
- Single-level unordered lists (`- item`) and ordered lists (`1. item`).
- Pipe tables with one header row, one separator row, and body rows.
- Inline bold (`**text**`) and inline code (`` `text` ``) as text styling in DOCX.
- Safe `http://` and `https://` links.

Rejected before DOCX write:

- HTML tags/comments.
- Images.
- Blockquotes.
- Fenced or indented code blocks.
- Nested lists.
- Malformed or ragged tables.
- Unsupported heading levels.
- Unsafe links or malformed Markdown links.
- Malformed/unclosed bold, inline-code, and link constructs; unsupported emphasis and horizontal rules.
- Raw control characters.
- Any construct this prototype cannot faithfully convert.

Validation errors cite a safe line number and construct name only; they do not echo user content.

## Limitations

- Minimal throwaway code, not production architecture.
- Uses Python standard library plus `python-docx` when available. If `python-docx` is missing, `run.sh` installs it into a local ignored `.venv/`.
- DOCX styles are intentionally basic: headings, normal paragraphs, list styles, `Table Grid`, bold, inline code font, and safe links. No branding, logo, cover, header, or footer.
- Markdown support is intentionally narrow; unsupported syntax is blocked rather than flattened.
- The prototype does not attempt visual fidelity beyond preserving document structure and basic styling.
- Generated `.md` and `.docx` files are ephemeral under `.tmp-run/`.
