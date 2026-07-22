import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';

export class MarkdownConversionError extends Error {
  constructor(code, line, message) {
    super(message);
    this.name = 'MarkdownConversionError';
    this.code = code;
    this.line = line;
    this.path = `markdown:${line}`;
  }
}

export function createTomcatReportSession(reports) {
  const states = new Map(reports.map(({ instanceId, markdown }) => [instanceId, {
    instanceId,
    systemMarkdown: markdown,
    markdown
  }]));

  const getState = (instanceId) => {
    const state = states.get(instanceId);
    if (!state) throw new Error(`未知巡检实例：${instanceId}`);
    return state;
  };

  return {
    updateMarkdown(instanceId, markdown) {
      getState(instanceId).markdown = markdown;
    },
    getReport(instanceId) {
      const state = getState(instanceId);
      return {
        instanceId,
        markdown: state.markdown,
        revisionStatus: state.markdown === state.systemMarkdown ? 'system-generated' : 'user-revised'
      };
    },
    preview(instanceId) {
      return previewTomcatMarkdown(getState(instanceId).markdown);
    },
    exportDocx(instanceId) {
      return exportTomcatDocx(getState(instanceId));
    }
  };
}

export function previewTomcatMarkdown(markdown) {
  return parseMarkdown(markdown);
}

export async function exportTomcatDocx({ instanceId, markdown, systemMarkdown }) {
  const blocks = parseMarkdown(markdown);
  const revised = markdown !== systemMarkdown;
  const children = [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: revised ? '用户修订报告' : '系统生成报告', bold: true })]
  })];

  for (const block of blocks) children.push(...renderBlock(block));

  const document = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 21 }, paragraph: { spacing: { after: 120 } } },
        title: { run: { font: 'Microsoft YaHei', size: 36, bold: true } },
        heading1: { run: { font: 'Microsoft YaHei', size: 28, bold: true } },
        heading2: { run: { font: 'Microsoft YaHei', size: 24, bold: true } }
      }
    },
    numbering: {
      config: [
        {
          reference: 'report-bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }]
        },
        {
          reference: 'report-numbering',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }]
        }
      ]
    },
    sections: [{ properties: {}, children }]
  });

  return {
    filename: revised
      ? `tomcat-${safeFilename(instanceId)}-user-revised.docx`
      : `tomcat-${safeFilename(instanceId)}.docx`,
    reportType: revised ? 'user-revised' : 'system-generated',
    content: await Packer.toBuffer(document)
  };
}

function safeFilename(instanceId) {
  return String(instanceId).replace(/[^\p{Letter}\p{Number}._-]+/gu, '-');
}

function parseMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const lineNumber = index + 1;
    const line = lines[index];
    if (/^```/.test(line)) unsupported(lineNumber, '代码块');
    if (/^#{4,}\s/.test(line)) unsupported(lineNumber, '四级及以下标题');
    if (/^\s*(?:\d+\.|[-+*])\s/.test(line) && /^\s+/.test(line)) unsupported(lineNumber, '嵌套列表');
    if (/^\s*<(?!https?:\/\/)/.test(line)) unsupported(lineNumber, 'HTML');
    if (/!\[[^\]]*\]\([^)]*\)/.test(line)) unsupported(lineNumber, '图片');

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: parseInline(heading[2], lineNumber), line: lineNumber });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const values = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        values.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: parseInline(values.join('\n'), lineNumber), line: lineNumber });
      continue;
    }

    if (/^[-+*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-+*]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^[-+*]\s+/, ''), index + 1));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: false, items, line: lineNumber });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^\d+\.\s+/, ''), index + 1));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: true, items, line: lineNumber });
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const header = splitTableRow(lines[index]);
      const separator = splitTableRow(lines[index + 1]);
      if (separator.length !== header.length) {
        throw new MarkdownConversionError('MARKDOWN_TABLE_INVALID', index + 2, 'Markdown 表格列数不一致，无法无损转换。');
      }
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const row = splitTableRow(lines[index]);
        if (row.length !== header.length) {
          throw new MarkdownConversionError('MARKDOWN_TABLE_INVALID', index + 1, 'Markdown 表格列数不一致，无法无损转换。');
        }
        rows.push(row.map((value) => parseInline(value, index + 1)));
        index += 1;
      }
      blocks.push({ type: 'table', header: header.map((value) => parseInline(value, lineNumber)), rows, line: lineNumber });
      continue;
    }

    if (/^\s*\|/.test(line)) unsupported(lineNumber, '无效表格');
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) unsupported(lineNumber, '分隔线');

    const values = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      values.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: parseInline(values.join('\n'), lineNumber), line: lineNumber });
  }

  if (blocks.length === 0) throw new MarkdownConversionError('MARKDOWN_EMPTY', 1, 'Markdown 内容不能为空。');
  return blocks;
}

function startsBlock(lines, index) {
  const line = lines[index];
  return /^(?:#{1,}\s|>|[-+*]\s+|\d+\.\s+|```|\s*\|)/.test(line);
}

function looksLikeTable(lines, index) {
  return /^\s*\|.*\|\s*$/.test(lines[index])
    && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1] ?? '');
}

function splitTableRow(line) {
  return line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
}

function parseInline(text, line) {
  if (/`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_)/.test(text)) {
    unsupported(line, '行内代码、链接、删除线或强调格式');
  }
  return text;
}

function unsupported(line, structure) {
  throw new MarkdownConversionError(
    'MARKDOWN_STRUCTURE_UNSUPPORTED',
    line,
    `Markdown 第 ${line} 行包含不支持且无法无损转换的结构：${structure}。`
  );
}

function renderBlock(block) {
  if (block.type === 'heading') {
    const headings = { 1: HeadingLevel.TITLE, 2: HeadingLevel.HEADING_1, 3: HeadingLevel.HEADING_2 };
    return [new Paragraph({ text: block.text, heading: headings[block.level] })];
  }
  if (block.type === 'paragraph') {
    return block.text.split('\n').map((text) => new Paragraph({ text }));
  }
  if (block.type === 'blockquote') {
    return block.text.split('\n').map((text) => new Paragraph({
      indent: { left: 360 },
      shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
      children: [new TextRun({ text, italics: true })]
    }));
  }
  if (block.type === 'list') {
    return block.items.map((text) => new Paragraph(block.ordered
      ? { text, numbering: { reference: 'report-numbering', level: 0 } }
      : { text, numbering: { reference: 'report-bullets', level: 0 } }));
  }
  if (block.type === 'table') {
    const tableRows = [block.header, ...block.rows].map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: row.map((text) => new TableCell({
        shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'D9EAF7' } : undefined,
        children: [new Paragraph({ children: [new TextRun({ text, bold: rowIndex === 0 })] })]
      }))
    }));
    return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows })];
  }
  return [];
}
