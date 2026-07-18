const SCRIPT = `#!/usr/bin/env bash
# Tomcat Inspector 0.1.0 — PROTOTYPE SAMPLE
set -u
printf '%s\\n' '=== MIDDLEWARE_INSPECTION_JSON_BEGIN ==='
printf '%s\\n' '{"middleware_type":"tomcat","protocol_version":"1.0"}'
printf '%s\\n' '=== MIDDLEWARE_INSPECTION_JSON_END ==='`;

const SAMPLE_LOG = `terminal$ ./inspect-tomcat.sh
=== MIDDLEWARE_INSPECTION_JSON_BEGIN ===
{
  "middleware_type": "tomcat",
  "protocol_version": "1.0",
  "host": {"hostname": "app-prod-07", "ips": ["10.24.8.17"]},
  "instances": [
    {"pid": 1842, "catalina_base": "/srv/tomcat/order-api"},
    {"pid": 2197, "catalina_base": "/srv/tomcat/console"},
    {"pid": null, "catalina_base": "/srv/tomcat/invalid"}
  ]
}
=== MIDDLEWARE_INSPECTION_JSON_END ===`;

const initialInstances = [
  { id: '1842', name: 'order-api', pid: 1842, path: '/srv/tomcat/order-api', counts: { n: 28, w: 3, a: 1, u: 2 }, edited: false,
    markdown: `# Tomcat 巡检报告 · order-api\n\n## 实例概况\n- 主机：app-prod-07 / 10.24.8.17\n- PID：1842\n- Tomcat：9.0.91\n- Java：17.0.11\n\n## 结论摘要\n- 正常：28\n- 警告：3\n- 异常：1\n- 无法判断：2\n\n## 重点发现\n- **异常**：Shutdown port 仍使用默认口令。\n- **警告**：Manager 应用存在，需核查访问范围。\n- **无法判断**：日志目录权限不足，无法确认轮转状态。` },
  { id: '2197', name: 'console', pid: 2197, path: '/srv/tomcat/console', counts: { n: 31, w: 1, a: 0, u: 1 }, edited: false,
    markdown: `# Tomcat 巡检报告 · console\n\n## 实例概况\n- 主机：app-prod-07 / 10.24.8.17\n- PID：2197\n- Tomcat：10.1.26\n- Java：21.0.3\n\n## 结论摘要\n- 正常：31\n- 警告：1\n- 异常：0\n- 无法判断：1\n\n## 重点发现\n- **警告**：HTTP Connector 使用明文传输，需结合代理拓扑核查。\n- **无法判断**：当前权限无法读取进程环境变量。` }
];

const state = {
  module: 'report',
  stage: 'input',
  inputMode: 'paste',
  log: '',
  error: '',
  instances: structuredClone(initialInstances),
  selected: '1842',
  editorMode: 'edit',
  toast: ''
};

const variants = {
  A: '引导式工作台',
  B: '双栏分析台',
  C: '实例报告队列'
};

function currentVariant() {
  const v = new URLSearchParams(location.search).get('variant') || 'A';
  return variants[v] ? v : 'A';
}
function setVariant(v) { const u = new URL(location.href); u.searchParams.set('variant', v); history.replaceState({}, '', u); render(); }
function cycleVariant(step) { const keys = Object.keys(variants); const i = keys.indexOf(currentVariant()); setVariant(keys[(i + step + keys.length) % keys.length]); }
function selectedInstance() { return state.instances.find(x => x.id === state.selected); }
function toast(message) { state.toast = message; render(); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => { state.toast = ''; render(); }, 1800); }
function stats(c) { return `<div class="stats"><span class="stat n">正常 ${c.n}</span><span class="stat w">警告 ${c.w}</span><span class="stat a">异常 ${c.a}</span><span class="stat u">无法判断 ${c.u}</span></div>`; }
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function markdownPreview(md) {
  return md.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith('- ')) return `<div>• ${escapeHtml(line.slice(2)).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>`;
    return line ? `<p>${escapeHtml(line).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>` : '';
  }).join('');
}
function moduleHeader() {
  return `<div class="prototype-ribbon">THROWAWAY PROTOTYPE · 无真实上传、分析或导出</div>
  <header class="topbar">
    <div class="brand">中间件巡检工具<small>EVIDENCE HANDOFF WORKBENCH</small></div>
    <nav class="nav" aria-label="主模块">
      <button data-action="module" data-value="script" class="${state.module === 'script' ? 'active' : ''}">脚本管理</button>
      <button data-action="module" data-value="report" class="${state.module === 'report' ? 'active' : ''}">报告生成</button>
    </nav>
    <div class="session-note">会话仅保存在当前页面 · 刷新后清空</div>
  </header>`;
}
function switcher() {
  const v = currentVariant();
  return `<div class="switcher" aria-label="原型方案切换"><button data-action="variant-prev" aria-label="上一方案">←</button><strong>${v} — ${variants[v]}</strong><button data-action="variant-next" aria-label="下一方案">→</button></div>`;
}
function scriptModule() {
  return `<main class="workspace">
    <section class="hero"><div><div class="eyebrow">脚本管理 · 独立模块</div><h1>取得当前审核版本，带到目标主机执行</h1><p class="lead">这里只提供当前发布的 Tomcat 只读巡检脚本。复制或下载不会创建巡检任务，也不会向报告生成传递状态。</p></div></section>
    <section class="card"><div class="card-header"><div><h2>Tomcat 只读巡检脚本</h2><p class="lead" style="margin-top:4px">Linux · Bash · 无 sudo · 不安装额外工具</p></div><span class="badge ok"><span class="dot"></span>当前发布</span></div>
      <div class="card-body">
        <div class="meta-grid"><div class="meta-item"><span>脚本版本</span><strong>0.1.0</strong></div><div class="meta-item"><span>协议版本</span><strong>1.0</strong></div><div class="meta-item"><span>适用组件</span><strong>Tomcat 9.0 / 10.1</strong></div></div>
        <div class="notice info">脚本仅读取当前账号可见的进程、配置和文件元数据。权限受限的项目会记录为未采集，不会要求 sudo。</div>
        <div class="codebox" style="margin:16px 0">${escapeHtml(SCRIPT)}</div>
        <div class="button-row"><button class="btn primary" data-action="copy-script">复制脚本</button><button class="btn" data-action="download-script">下载 inspect-tomcat.sh</button></div>
      </div>
    </section>
  </main>`;
}
function inputPanel(compact = false) {
  return `<section class="card"><div class="card-header"><div><h2>提交标准巡检日志</h2><p class="lead" style="margin-top:4px">一次提交一份日志，可包含同一主机的多个实例</p></div><span class="badge">Tomcat</span></div>
  <div class="card-body section-stack">
    <div class="field"><label>中间件类型</label><select aria-label="中间件类型"><option>Tomcat</option></select></div>
    <div class="editor-tabs" style="padding:0"><button data-action="input-mode" data-value="paste" class="${state.inputMode === 'paste' ? 'active' : ''}">粘贴日志</button><button data-action="input-mode" data-value="upload" class="${state.inputMode === 'upload' ? 'active' : ''}">上传文件</button></div>
    ${state.inputMode === 'paste' ? `<div class="field"><label for="log-input">包含边界标记的完整输出</label><textarea id="log-input" placeholder="粘贴巡检脚本的完整终端输出…">${escapeHtml(state.log)}</textarea></div>` : `<label class="file-field">选择 .log 或 .txt 文件 <input id="file-input" type="file" accept=".log,.txt,.json" /></label>`}
    ${state.error ? `<div class="notice error"><strong>无法处理日志</strong><br>${state.error}<br>请保留一对完整边界标记，并确认其中只有一个合法 JSON 文档。</div>` : ''}
    <div class="button-row"><button class="btn ghost" data-action="load-sample">载入多实例样本</button><button class="btn primary" data-action="generate">生成报告</button></div>
  </div></section>`;
}
function instanceList() {
  return `<div class="instance-list">${state.instances.map(i => `<button class="instance ${i.id === state.selected ? 'active' : ''}" data-action="select-instance" data-value="${i.id}"><div class="instance-name"><span>${i.name}</span>${i.edited ? '<span class="badge edited">已编辑</span>' : '<span class="badge ok">系统生成</span>'}</div><div class="instance-meta">PID ${i.pid} · ${i.path}</div>${stats(i.counts)}</button>`).join('')}</div>
  <div class="notice warn" style="margin-top:10px">另有 1 个实例被跳过：缺少 PID，无法建立最小实例身份。</div>`;
}
function reportEditor() {
  const i = selectedInstance();
  return `<section class="card"><div class="card-header"><div><h2>${i.name} · PID ${i.pid}</h2><p class="lead" style="margin-top:4px">${i.path}</p></div><div class="button-row"><button class="btn" data-action="export-current">导出当前 DOCX</button><button class="btn teal" data-action="export-all">导出全部 ZIP</button></div></div>
    <div class="editor-tabs"><button data-action="editor-mode" data-value="edit" class="${state.editorMode === 'edit' ? 'active' : ''}">编辑 Markdown</button><button data-action="editor-mode" data-value="preview" class="${state.editorMode === 'preview' ? 'active' : ''}">预览</button></div>
    ${state.editorMode === 'edit' ? `<div class="card-body"><textarea id="markdown-input" style="min-height:390px">${escapeHtml(i.markdown)}</textarea><div class="notice info" style="margin-top:12px">最终 DOCX 使用当前 Markdown。修改后报告会标记为“用户修订”。</div></div>` : `<article class="report-preview">${markdownPreview(i.markdown)}</article>`}
  </section>`;
}
function resultsSummary() {
  return `<div class="notice success"><strong>已生成 2 份报告</strong> · 1 个实例被跳过。每个实例的编辑内容在本次页面会话中独立保留。</div>`;
}
function variantA() {
  const step = state.stage === 'input' ? 1 : 2;
  return `<main class="workspace"><section class="hero"><div><div class="eyebrow">方案 A · 引导式工作台</div><h1>${state.stage === 'input' ? '从一份日志开始报告会话' : '逐份复核，再统一带走'}</h1><p class="lead">用明确步骤降低首次使用成本；实例拆分后转为左侧清单、右侧编辑。</p></div>${state.stage === 'results' ? '<button class="btn ghost" data-action="reset">结束本次会话</button>' : ''}</section>
  <div class="rail-layout"><aside class="card steps"><div class="step ${step===1?'active':''}"><span class="step-index">1</span><div><strong>提交日志</strong><small style="display:block">选择类型并校验</small></div></div><div class="step ${step===2?'active':''}"><span class="step-index">2</span><div><strong>复核报告</strong><small style="display:block">按实例编辑</small></div></div><div class="step"><span class="step-index">3</span><div><strong>导出</strong><small style="display:block">单份或全部</small></div></div></aside><div class="section-stack">${state.stage === 'input' ? inputPanel() : `${resultsSummary()}<div class="result-grid"><aside class="card"><div class="card-header"><h3>实例报告</h3><span class="badge">2 份</span></div><div class="card-body">${instanceList()}</div></aside>${reportEditor()}</div>`}</div></div></main>`;
}
function variantB() {
  return `<main class="workspace"><div class="compact-head"><div><div class="eyebrow">方案 B · 双栏分析台</div><h1 style="font-size:28px">输入和结果并置，适合高频操作</h1></div>${state.stage === 'results' ? '<button class="btn ghost" data-action="reset">清空会话</button>' : ''}</div>
  <div class="console-grid"><div class="console-left">${inputPanel(true)}<section class="card"><div class="card-header"><h3>会话约束</h3></div><div class="card-body"><div class="notice info">不保存日志、报告或编辑历史。切换实例保留本页内修改，刷新即清空。</div></div></section></div>
  <section class="card">${state.stage === 'input' ? '<div class="empty"><div><h2>等待标准巡检日志</h2><p>校验通过后，这里同时展示实例列表和报告编辑区。</p></div></div>' : `<div class="compact-head">${resultsSummary()}<button class="btn teal" data-action="export-all">全部 DOCX · ZIP</button></div><div class="results-console"><aside>${instanceList()}</aside><main>${reportEditor()}</main></div>`}</section></div></main>`;
}
function variantC() {
  return `<main class="workspace"><section class="session-banner"><div><div class="eyebrow" style="color:#82d3ca">方案 C · 实例报告队列</div><h1 style="font-size:30px">把报告当作一组待复核交付物</h1><p>先完成日志解析，再按队列处理每个实例；编辑状态和导出状态一眼可见。</p></div><span class="badge" style="background:#294e67;color:#fff">临时会话</span></section>
  ${state.stage === 'input' ? inputPanel() : `<div class="queue-layout"><section class="card"><div class="card-header"><div><h2>报告队列</h2><p class="lead" style="margin-top:4px">2 份可导出 · 1 个实例已跳过</p></div><button class="btn teal" data-action="export-all">导出全部 ZIP</button></div>${state.instances.map(i => `<button class="queue-item ${i.id===state.selected?'active':''}" style="width:100%;border-left:0;border-right:0;border-top:0;background:${i.id===state.selected?'#eef6f7':'#fff'};text-align:left" data-action="select-instance" data-value="${i.id}"><div><div class="instance-name" style="justify-content:flex-start;gap:8px"><strong>${i.name}</strong>${i.edited?'<span class="badge edited">已编辑</span>':'<span class="badge ok">待复核</span>'}</div><div class="instance-meta" style="margin:5px 0">PID ${i.pid} · ${i.path}</div>${stats(i.counts)}</div><span>→</span></button>`).join('')}<div class="card-body"><div class="notice warn">跳过 invalid：缺少 PID。其他报告不受影响。</div><button class="btn ghost" data-action="reset" style="margin-top:10px">结束并清空会话</button></div></section>${reportEditor()}</div>`}</main>`;
}
function render() {
  const v = currentVariant();
  const content = state.module === 'script' ? scriptModule() : (v === 'A' ? variantA() : v === 'B' ? variantB() : variantC());
  document.getElementById('app').innerHTML = `<div class="variant-${v.toLowerCase()}">${moduleHeader()}${content}</div>${switcher()}${state.toast ? `<div class="toast">${state.toast}</div>` : ''}`;
  bindInputs();
}
function bindInputs() {
  const log = document.getElementById('log-input');
  if (log) log.addEventListener('input', e => { state.log = e.target.value; });
  const md = document.getElementById('markdown-input');
  if (md) md.addEventListener('input', e => { const i = selectedInstance(); i.markdown = e.target.value; i.edited = true; });
  const file = document.getElementById('file-input');
  if (file) file.addEventListener('change', e => { if (e.target.files[0]) { state.log = SAMPLE_LOG; toast(`已载入 ${e.target.files[0].name}（模拟）`); } });
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, v = el.dataset.value;
  if (a === 'variant-prev') cycleVariant(-1);
  if (a === 'variant-next') cycleVariant(1);
  if (a === 'module') { state.module = v; render(); }
  if (a === 'input-mode') { state.inputMode = v; state.error = ''; render(); }
  if (a === 'load-sample') { state.log = SAMPLE_LOG; state.error = ''; render(); }
  if (a === 'generate') {
    const text = state.log.trim();
    if (!text.includes('MIDDLEWARE_INSPECTION_JSON_BEGIN') || !text.includes('MIDDLEWARE_INSPECTION_JSON_END')) { state.error = '未找到一对完整的标准日志边界标记。'; render(); return; }
    if (text.includes('"middleware_type": "nginx"')) { state.error = '已选择 Tomcat，但日志声明的中间件类型是 Nginx。系统不会自动切换组件。'; render(); return; }
    state.error = ''; state.stage = 'results'; render(); toast('已生成 2 份实例报告');
  }
  if (a === 'select-instance') { state.selected = v; render(); }
  if (a === 'editor-mode') { state.editorMode = v; render(); }
  if (a === 'copy-script') navigator.clipboard?.writeText(SCRIPT).then(() => toast('脚本已复制')).catch(() => toast('已模拟复制脚本'));
  if (a === 'download-script') toast('已下载 inspect-tomcat.sh（模拟）');
  if (a === 'export-current') toast(`${selectedInstance().name}.docx 已导出（模拟）`);
  if (a === 'export-all') toast(`已导出 tomcat-reports.zip · ${state.instances.filter(i=>i.edited).length} 份用户修订（模拟）`);
  if (a === 'reset') { state.stage='input'; state.log=''; state.error=''; state.instances=structuredClone(initialInstances); state.selected='1842'; state.editorMode='edit'; render(); }
});
document.addEventListener('keydown', e => {
  if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
  const tag = document.activeElement?.tagName;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag) || document.activeElement?.isContentEditable) return;
  cycleVariant(e.key === 'ArrowLeft' ? -1 : 1);
});
window.addEventListener('popstate', render);
render();
