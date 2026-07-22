const sampleLog = `=== MIDDLEWARE_INSPECTION_JSON_BEGIN ===
{
  "protocol_version": "1.0",
  "middleware_type": "tomcat",
  "host": { "ip": "10.20.8.16" },
  "instances": [
    { "pid": 1842, "catalina_base": "/opt/tomcat-order" },
    { "pid": 2917, "catalina_base": "/opt/tomcat-member" }
  ]
}
=== MIDDLEWARE_INSPECTION_JSON_END ===`;

const instances = [
  { id: 'pid:1842', name: 'order-service', path: '/opt/tomcat-order', danger: 2, warn: 3, edited: false },
  { id: 'pid:2917', name: 'member-service', path: '/opt/tomcat-member', danger: 0, warn: 1, edited: false },
];

const initialMarkdown = {
  'pid:1842': `# Tomcat 巡检报告：order-service

## 实例概况

- **实例标识：** \`pid:1842\`
- **安装路径：** \`/opt/tomcat-order\`
- **Tomcat 版本：** 10.1.24

## 检查结论

| 检查项 | 结论 | 说明 |
| --- | --- | --- |
| AJP 连接器 | 不符合 | 连接器仍处于启用状态 |
| JVM 堆内存 | 需关注 | 最大堆内存为 2 GiB |
| 文件权限 | 符合 | 关键配置文件不可被其他用户写入 |

## 建议

1. 确认未使用 AJP 后关闭该连接器。
2. 结合峰值负载复核最大堆内存。`,
  'pid:2917': `# Tomcat 巡检报告：member-service

## 实例概况

- **实例标识：** \`pid:2917\`
- **安装路径：** \`/opt/tomcat-member\`
- **Tomcat 版本：** 9.0.91

## 检查结论

| 检查项 | 结论 | 说明 |
| --- | --- | --- |
| JVM 堆内存 | 需关注 | 最大堆内存为 1 GiB |
| 文件权限 | 符合 | 关键配置文件不可被其他用户写入 |

## 建议

1. 结合业务负载复核最大堆内存。`
};

const state = {
  page: 'reports',
  phase: 'input',
  inputMode: 'paste',
  log: sampleLog,
  showError: false,
  current: 'pid:1842',
  markdown: structuredClone(initialMarkdown),
  validated: { 'pid:1842': true, 'pid:2917': true },
  validationPending: {},
  toast: '',
  dialog: false,
};

const variantNames = { A: '阶段导轨', B: '任务台账', C: '实例优先' };
const getVariant = () => {
  const value = new URLSearchParams(location.search).get('variant')?.toUpperCase();
  return ['A', 'B', 'C'].includes(value) ? value : 'A';
};

function esc(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  let html = '';
  let inList = false;
  let inTable = false;
  for (const raw of lines) {
    const line = esc(raw);
    if (line.startsWith('|')) {
      if (/^\|[\s:\-|]+\|$/.test(line)) continue;
      if (!inTable) { html += '<table><tbody>'; inTable = true; }
      const cells = line.split('|').slice(1, -1).map(cell => `<td>${inline(cell.trim())}</td>`).join('');
      html += `<tr>${cells}</tr>`;
      continue;
    }
    if (inTable) { html += '</tbody></table>'; inTable = false; }
    if (/^\d+\. /.test(line)) {
      if (!inList) { html += '<ol>'; inList = true; }
      html += `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`;
      continue;
    }
    if (inList) { html += '</ol>'; inList = false; }
    if (line.startsWith('# ')) html += `<h1>${inline(line.slice(2))}</h1>`;
    else if (line.startsWith('## ')) html += `<h2>${inline(line.slice(3))}</h2>`;
    else if (line.startsWith('- ')) html += `<p>• ${inline(line.slice(2))}</p>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ol>';
  if (inTable) html += '</tbody></table>';
  return html;
}

function inline(value) {
  return value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
}

function header() {
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark"><span>MI</span></span>中间件巡检</div>
    <nav class="nav" aria-label="主导航">
      <button data-page="scripts" class="${state.page === 'scripts' ? 'active' : ''}">脚本管理</button>
      <button data-page="reports" class="${state.page === 'reports' ? 'active' : ''}">报告生成</button>
    </nav>
    <div class="top-note">仅在本机运行 · 本次会话不保存</div>
  </header>`;
}

function scriptsPage() {
  return `<main class="page">
    <div class="eyebrow">只读采集脚本 / current release</div>
    <h1>把可信脚本带到现场</h1>
    <p class="lede">这里不创建任务，也不连接客户环境。复制或下载脚本后，由人员通过 VPN 与堡垒机在目标 Linux 主机手工执行。</p>
    <section class="script-layout">
      <div class="panel">
        <div class="script-head">
          <div><strong>Tomcat 只读巡检脚本</strong><div class="script-meta"><span>脚本 v1.0.0</span><span>协议 v1.0</span><span>tomcat-inspect.sh</span></div></div>
          <div class="actions"><button class="btn" data-action="copy">复制脚本</button><button class="btn primary" data-action="download-script">下载脚本</button></div>
        </div>
        <pre class="code">#!/usr/bin/env bash
set -u

readonly BEGIN_MARKER='=== MIDDLEWARE_INSPECTION_JSON_BEGIN ==='
readonly END_MARKER='=== MIDDLEWARE_INSPECTION_JSON_END ==='

# PROTOTYPE — 仅展示当前发布脚本的界面反馈
printf '%s\\n' "$BEGIN_MARKER"
collect_visible_tomcat_instances
printf '%s\\n' "$END_MARKER"</pre>
      </div>
      <aside class="panel aside">
        <h3>适用与限制</h3>
        <div class="fact"><strong>正式支持</strong><span class="badge good"><span class="dot"></span>Tomcat 9.0 / 10.1</span></div>
        <div class="fact"><strong>执行权限</strong><span>普通 Linux 用户，不使用 sudo</span></div>
        <div class="fact"><strong>行为边界</strong><span>只读采集，不修改配置或服务状态</span></div>
        <div class="fact"><strong>下一步</strong><span>执行后复制完整标准日志，再独立进入报告生成。</span></div>
      </aside>
    </section>
  </main>`;
}

function stageRail() {
  const phases = ['input', 'review', 'export'];
  const current = phases.indexOf(state.phase);
  return `<div class="stage-rail">${phases.map((phase, index) => `<div class="stage ${index < current ? 'done' : ''} ${phase === state.phase ? 'active' : ''}"><b>${String(index + 1).padStart(2, '0')}</b>${['提交标准日志', '复核实例报告', '导出报告'][index]}</div>`).join('')}</div>`;
}

function inputContent() {
  return `<section class="panel input-panel">
    <label class="field-label">中间件类型</label>
    <div class="select-static">Tomcat <span class="subtle">（MVP 当前唯一可选）</span></div>
    <label class="field-label">标准巡检日志</label>
    <div class="tabs"><button class="tab ${state.inputMode === 'paste' ? 'active' : ''}" data-mode="paste">粘贴日志</button><button class="tab ${state.inputMode === 'upload' ? 'active' : ''}" data-mode="upload">上传文件</button></div>
    ${state.inputMode === 'paste' ? `<textarea class="log-input" aria-label="标准巡检日志">${esc(state.log)}</textarea>` : `<div class="dropzone" tabindex="0"><div><strong>选择一份标准巡检日志</strong><p class="subtle">上传与粘贴使用完全相同的校验流程</p><button class="btn">选择文件</button></div></div>`}
    ${state.showError ? `<div class="error-box" role="alert"><div class="error-code">LOG_BOUNDARY_INCOMPLETE · 结尾标记缺失</div><strong>无法提取完整标准日志。</strong><p>请从 <code>…_JSON_BEGIN</code> 到 <code>…_JSON_END</code> 完整复制脚本输出；系统不会自动补齐或修复。</p></div>` : `<div class="notice">分析只读取这一份日志。发现无效实例时会跳过并说明原因，其余有效实例继续生成报告。</div>`}
    <div class="actions"><button class="btn primary" data-action="analyze">分析并生成报告</button><button class="btn" data-action="toggle-error">${state.showError ? '收起错误示例' : '查看错误示例'}</button></div>
  </section>`;
}

function instanceList(variant) {
  return `<aside class="instances">
    <div class="instances-head"><div class="eyebrow">${variant === 'C' ? '报告队列 / 2 valid' : '有效实例 · 2'}</div><strong>${variant === 'C' ? '逐份复核与导出' : '选择一份报告'}</strong></div>
    ${instances.map((item, index) => `<button class="instance ${item.id === state.current ? 'active' : ''}" data-instance="${item.id}">
      <div class="instance-title">${variant === 'C' ? `<span class="queue-number">${String(index + 1).padStart(2, '0')}</span>` : ''}<span>${item.name}</span><span class="badge ${state.markdown[item.id] !== initialMarkdown[item.id] ? 'warn' : ''}">${state.markdown[item.id] !== initialMarkdown[item.id] ? '已编辑' : '系统生成'}</span></div>
      <div class="instance-meta">${item.id} · ${item.path}</div>
      <div class="counts"><span class="bad-count">不符合 ${item.danger}</span><span class="warn-count">需关注 ${item.warn}</span><span>符合 ${item.id === 'pid:1842' ? 14 : 18}</span></div>
    </button>`).join('')}
    <div class="skipped"><strong>已跳过 1 个实例</strong><br>instances/2 · PID 缺失，无法建立当次实例身份。</div>
  </aside>`;
}

function editorPanel() {
  const current = state.current;
  const pending = state.validationPending[current];
  const valid = state.validated[current];
  return `<section class="editor">
    <div class="editor-head"><div><strong>Markdown 编辑</strong><div class="subtle">切换实例不会丢失本次修改</div></div><span class="badge ${pending ? 'warn' : valid ? 'good' : 'bad'}"><span class="dot"></span>${pending ? '等待权威校验' : valid ? '权威校验通过' : '存在不可导出结构'}</span></div>
    <textarea class="markdown" aria-label="Markdown 编辑器">${esc(state.markdown[current])}</textarea>
  </section>`;
}

function previewPanel() {
  return `<section class="preview"><div class="preview-head"><div><strong>安全即时预览</strong><div class="subtle">不执行 HTML、脚本或外部资源</div></div><span class="badge">受限 Markdown</span></div><article class="preview-body">${renderMarkdown(state.markdown[state.current])}</article></section>`;
}

function workspace(variant) {
  const inner = variant === 'C'
    ? `${instanceList(variant)}<div class="editor-preview-stack">${editorPanel()}${previewPanel()}</div>`
    : `${instanceList(variant)}${editorPanel()}${previewPanel()}`;
  return `<section class="workspace">${inner}</section>
    <div class="exportbar"><div><strong>当前实例：${instances.find(item => item.id === state.current).name}</strong><div class="subtle">导出直接下载；服务端不保留下载地址。</div></div><div class="actions"><button class="btn" data-action="export-one">导出当前 DOCX</button><button class="btn primary" data-action="export-all">导出全部 ZIP</button><button class="btn danger" data-action="end">结束本次会话</button></div></div>`;
}

function ledger() {
  const review = state.phase !== 'input';
  return `<aside class="panel ledger"><div class="eyebrow">本次会话</div><h3>处理台账</h3>
    <div class="ledger-step done"><strong>提交日志</strong><br><span class="subtle">Tomcat · 单份输入</span></div>
    <div class="ledger-step ${review ? 'active' : ''}"><strong>复核报告</strong><br><span class="subtle">2 有效 · 1 跳过</span></div>
    <div class="ledger-step"><strong>导出产物</strong><br><span class="subtle">DOCX 或 ZIP</span></div>
    <div class="ledger-rule">浏览器刷新或关闭后无法恢复。全部编辑仅保留在当前页面内存中。</div></aside>`;
}

function reportsPage(variant) {
  const isInput = state.phase === 'input';
  const heading = isInput ? '从一份标准日志开始' : variant === 'C' ? '两份报告等待复核' : '复核每个实例的报告';
  const body = isInput ? inputContent() : workspace(variant);
  if (variant === 'B') {
    return `<main class="page variant-b"><div class="eyebrow">报告生成 / transient session</div><h1>${heading}</h1><p class="lede">输入、分析、编辑与导出属于一次临时会话；没有任务历史，也不承诺刷新恢复。</p><div class="report-frame">${ledger()}<div>${body}</div></div></main>`;
  }
  if (variant === 'C') {
    return `<main class="page variant-c"><div class="eyebrow">报告生成 / instance queue</div><h1>${heading}</h1><p class="lede">优先看清每个实例的处理状态；所有有效实例一次生成，逐份编辑，独立或批量导出。</p>${isInput ? stageRail() : `<div class="summary-strip"><div><strong>分析完成：2 个有效实例，1 个实例已跳过</strong><div class="subtle">跳过不会阻断其余报告。</div></div><span class="badge good"><span class="dot"></span>规则与报告已生成</span></div>`}${body}</main>`;
  }
  return `<main class="page"><div class="eyebrow">报告生成 / guided workbench</div><h1>${heading}</h1><p class="lede">完成当前阶段后再进入下一阶段，避免日志输入和报告结果长期并置。</p>${stageRail()}${body}</main>`;
}

function switcher(variant) {
  return `<div class="switcher" aria-label="原型方案切换"><button data-switch="prev" aria-label="上一个方案">←</button><div class="switcher-label">${variant} — ${variantNames[variant]}</div><button data-switch="next" aria-label="下一个方案">→</button></div>`;
}

function dialog() {
  if (!state.dialog) return '';
  return `<div class="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="eyebrow">不可恢复</div><h2 id="dialog-title">结束本次会话？</h2><p>输入日志、实例报告和 Markdown 修改都会立即从当前页面清空。之后需要重新提交日志生成。</p><div class="actions"><button class="btn" data-action="cancel-end">继续编辑</button><button class="btn danger" data-action="confirm-end">清空并结束</button></div></div></div>`;
}

function render() {
  const variant = getVariant();
  document.querySelector('#app').innerHTML = `<div class="app-shell variant-${variant.toLowerCase()}">${header()}${state.page === 'scripts' ? scriptsPage() : reportsPage(variant)}${switcher(variant)}${state.toast ? `<div class="toast" role="status">${state.toast}</div>` : ''}${dialog()}</div>`;
  bind();
}

function notify(message) {
  state.toast = message;
  render();
  setTimeout(() => { state.toast = ''; render(); }, 1900);
}

function switchVariant(direction) {
  const variants = ['A', 'B', 'C'];
  const current = variants.indexOf(getVariant());
  const next = variants[(current + direction + variants.length) % variants.length];
  const url = new URL(location.href);
  url.searchParams.set('variant', next);
  history.replaceState({}, '', url);
  render();
}

function bind() {
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { state.page = button.dataset.page; render(); });
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { state.inputMode = button.dataset.mode; state.showError = false; render(); });
  document.querySelector('.log-input')?.addEventListener('input', event => { state.log = event.target.value; });
  document.querySelector('.markdown')?.addEventListener('input', event => {
    state.markdown[state.current] = event.target.value;
    state.validationPending[state.current] = true;
    state.validated[state.current] = false;
    document.querySelector('.preview-body').innerHTML = renderMarkdown(event.target.value);
    const badge = document.querySelector('.editor-head .badge');
    badge.className = 'badge warn'; badge.innerHTML = '<span class="dot"></span>等待权威校验';
    clearTimeout(window.validationTimer);
    window.validationTimer = setTimeout(() => { state.validationPending[state.current] = false; state.validated[state.current] = true; render(); }, 750);
  });
  document.querySelectorAll('[data-instance]').forEach(button => button.onclick = () => { state.current = button.dataset.instance; render(); });
  document.querySelectorAll('[data-switch]').forEach(button => button.onclick = () => switchVariant(button.dataset.switch === 'next' ? 1 : -1));
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
    const action = button.dataset.action;
    if (action === 'copy') { try { await navigator.clipboard.writeText('#!/usr/bin/env bash\n# Tomcat read-only inspection'); } catch {} notify('脚本已复制 · v1.0.0 / 协议 v1.0'); }
    if (action === 'download-script') notify('已下载 tomcat-inspect.sh · 内容与展示版本一致');
    if (action === 'toggle-error') { state.showError = !state.showError; render(); }
    if (action === 'analyze') { state.showError = false; state.phase = 'review'; render(); notify('分析完成 · 2 个有效实例，1 个实例已跳过'); }
    if (action === 'export-one') notify(`${instances.find(item => item.id === state.current).name}.docx 已下载`);
    if (action === 'export-all') notify('tomcat-reports.zip 已下载 · 包含 2 份独立 DOCX');
    if (action === 'end') { state.dialog = true; render(); }
    if (action === 'cancel-end') { state.dialog = false; render(); }
    if (action === 'confirm-end') { Object.assign(state, { phase: 'input', markdown: structuredClone(initialMarkdown), current: 'pid:1842', dialog: false, showError: false }); render(); notify('本次会话已结束，临时内容已清空'); }
  });
}

document.addEventListener('keydown', event => {
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA'].includes(tag) || document.activeElement?.isContentEditable) return;
  if (event.key === 'ArrowLeft') switchVariant(-1);
  if (event.key === 'ArrowRight') switchVariant(1);
});

render();
