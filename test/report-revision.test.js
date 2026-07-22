import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import {
  MarkdownConversionError,
  createTomcatReportSession,
  exportTomcatDocx,
  previewTomcatMarkdown
} from '../src/report-revision.js';

const generatedMarkdown = `# Tomcat 单实例巡检报告

系统生成说明。

## 巡检结论

- 证据：端口 8080
- 建议：保持配置审查

| 巡检项 | 结论 | 建议 |
| --- | --- | --- |
| tomcat.http.port.present | 正常 | 保持配置审查 |

> 证据来自只读采集。`;

async function reopenDocx(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const documentXml = await archive.file('word/document.xml').async('string');
  const decode = (text) => text
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const paragraphs = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map(([, xml]) => decode(xml).trim())
    .filter(Boolean);
  const tables = [...documentXml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(([, tableXml]) =>
    [...tableXml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map(([, rowXml]) =>
      [...rowXml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(([, cellXml]) => decode(cellXml).trim())
    )
  );
  return { documentXml, paragraphs, tables };
}

test('a report session preserves independent Markdown edits and previews supported report structures', () => {
  const session = createTomcatReportSession([
    { instanceId: 'host:1001', markdown: generatedMarkdown },
    { instanceId: 'host:1002', markdown: '# 第二份报告\n\n未修改。' }
  ]);
  const revised = generatedMarkdown.replace('正常', '异常').replace('保持配置审查', '人工确认后整改');

  session.updateMarkdown('host:1001', revised);

  assert.equal(session.getReport('host:1001').markdown, revised);
  assert.equal(session.getReport('host:1001').revisionStatus, 'user-revised');
  assert.equal(session.getReport('host:1002').revisionStatus, 'system-generated');
  assert.deepEqual(session.preview('host:1001'), previewTomcatMarkdown(revised));
  assert.deepEqual(session.preview('host:1001').map(({ type }) => type), [
    'heading', 'paragraph', 'heading', 'list', 'table', 'blockquote'
  ]);
});

test('DOCX export reopens with the current revised headings, paragraphs, lists and table semantics', async () => {
  const revised = generatedMarkdown
    .replace('系统生成说明。', '用户改写后的最终结论。')
    .replace('正常', '异常')
    .replaceAll('保持配置审查', '人工确认后整改');

  const exported = await exportTomcatDocx({
    instanceId: 'host:1001',
    markdown: revised,
    systemMarkdown: generatedMarkdown
  });
  const reopened = await reopenDocx(exported.content);

  assert.equal(exported.filename, 'tomcat-host-1001-user-revised.docx');
  assert.equal(exported.reportType, 'user-revised');
  assert.match(reopened.documentXml, /w:val="Title"/);
  assert.match(reopened.documentXml, /w:val="Heading1"/);
  assert.ok(reopened.paragraphs.includes('用户修订报告'));
  assert.ok(reopened.paragraphs.includes('用户改写后的最终结论。'));
  assert.ok(reopened.paragraphs.includes('证据：端口 8080'));
  assert.deepEqual(reopened.tables[0], [
    ['巡检项', '结论', '建议'],
    ['tomcat.http.port.present', '异常', '人工确认后整改']
  ]);
  assert.ok(!reopened.paragraphs.includes('系统生成说明。'));
  assert.ok(!reopened.paragraphs.includes('正常'));
});

test('export uses unchanged system Markdown without labeling it as revised', async () => {
  const exported = await exportTomcatDocx({
    instanceId: 'host:1002',
    markdown: generatedMarkdown,
    systemMarkdown: generatedMarkdown
  });
  const reopened = await reopenDocx(exported.content);

  assert.equal(exported.reportType, 'system-generated');
  assert.equal(exported.filename, 'tomcat-host-1002.docx');
  assert.ok(reopened.paragraphs.includes('系统生成报告'));
  assert.ok(!reopened.paragraphs.includes('用户修订报告'));
});

test('unsupported or lossy Markdown stops export with a locatable error', async () => {
  const markdown = `${generatedMarkdown}\n\n### 附录\n\n\`\`\`bash\nsystemctl restart tomcat\n\`\`\``;

  await assert.rejects(
    exportTomcatDocx({ instanceId: 'host:1001', markdown, systemMarkdown: generatedMarkdown }),
    (error) => error instanceof MarkdownConversionError
      && error.code === 'MARKDOWN_STRUCTURE_UNSUPPORTED'
      && error.line === 18
      && error.path === 'markdown:18'
      && /代码块/.test(error.message)
  );
});

test('all promised lossy structures and malformed tables fail at their source line', async () => {
  const invalidCases = [
    ['# 报告\n\n![拓扑](topology.png)', 'MARKDOWN_STRUCTURE_UNSUPPORTED', 3],
    ['# 报告\n\n<div>内容</div>', 'MARKDOWN_STRUCTURE_UNSUPPORTED', 3],
    ['# 报告\n\n| A | B |\n| --- | --- |\n| only-one |', 'MARKDOWN_TABLE_INVALID', 5],
    ['# 报告\n\n    - 嵌套项', 'MARKDOWN_STRUCTURE_UNSUPPORTED', 3]
  ];

  for (const [markdown, code, line] of invalidCases) {
    await assert.rejects(
      exportTomcatDocx({ instanceId: 'host:1001', markdown, systemMarkdown: generatedMarkdown }),
      (error) => error instanceof MarkdownConversionError
        && error.code === code
        && error.line === line
        && error.path === `markdown:${line}`
    );
  }
});
