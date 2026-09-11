import { escapeHtml } from '../../shared/ui-helpers.js';

const PHASES = {
  'omnidoc:source': 'Read source and inventory',
  'omnidoc:interpret': 'Interpret pages',
  'omnidoc:page_inputs_save': 'Save page inputs',
  'omnidoc:page_analysis_save': 'Save page analysis',
  'omnidoc:contents_links': 'Link contents entries',
  'omnidoc:assemble': 'Assemble document',
  'omnidoc:continuations': 'Link paragraphs across pages',
  'omnidoc:sections': 'Build sections',
  'omnidoc:publish': 'Save document and capture',
};
const QUESTIONS = {
  source_regions: 'Figure and table areas', source_roles: 'Source roles',
  line_membership: 'Join source lines', wrap_hyphens: 'Line-end hyphens',
  heading_structure: 'Heading structure', container_count: 'Count containers',
  containers: 'Container membership', table_axes: 'Table rows and columns',
  table_grid: 'Table grid', figure_labels: 'Figure labels',
  page_connections: 'Reading order and relations', note_markers: 'Footnote markers',
  reading_order_placement: 'Place unresolved reading-order blocks',
  contents: 'Contents destinations', continuations: 'Paragraphs across pages',
};
const duration = (span) => Math.max(0, span.t_end_ms - span.t_start_ms);

export function summarizeOmnidocTimings(timeline, page = null) {
  const spans = (timeline?.spans || []).filter((s) => typeof s.stage === 'string'
    && Number.isFinite(s.t_start_ms) && Number.isFinite(s.t_end_ms)
    && (page === null || s.page === page));
  const envelope = spans.filter((s) => s.stage === (page === null ? 'omnidoc' : 'omnidoc:page'));
  if (!envelope.length) return null;
  const phases = Object.entries(PHASES).map(([stage, label]) => {
    const entries = spans.filter((s) => s.stage === stage);
    return { label, ms: entries.reduce((n, s) => n + duration(s), 0), measured: entries.length > 0 };
  }).filter((p) => p.measured);
  const questions = new Map();
  for (const span of spans) {
    const match = /^(pool:omnidoc_|omnidoc:cache:|omnidoc:retry:)(.+?)(:admit)?$/.exec(span.stage);
    if (!match) continue;
    const [, prefix, name] = match;
    if (!questions.has(name)) questions.set(name, { name, label: QUESTIONS[name] || name,
      calls: 0, cached: 0, retries: 0, ms: 0, wait: 0 });
    const item = questions.get(name);
    if (prefix === 'omnidoc:cache:') item.cached += 1;
    else if (prefix === 'omnidoc:retry:') item.retries += 1;
    else {
      item.ms += duration(span);
      if (span.kind === 'wait') item.wait += duration(span);
      else if (!match[3]) item.calls += 1;
    }
  }
  const rows = [...questions.values()].sort((a, b) => b.ms - a.ms);
  return { elapsed: envelope.reduce((n, s) => n + duration(s), 0), phases, questions: rows,
    calls: rows.reduce((n, q) => n + q.calls, 0), cached: rows.reduce((n, q) => n + q.cached, 0),
    retries: rows.reduce((n, q) => n + q.retries, 0),
    callMs: rows.reduce((n, q) => n + q.ms, 0), wait: rows.reduce((n, q) => n + q.wait, 0) };
}

export function renderOmnidocTimings(summary, { page = false } = {}) {
  if (!summary) return '';
  const row = (label, value, cls = 'trt-l1') => `<div class="trt-row ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  const ms = (value) => `${Math.round(value)} ms`;
  const out = [row(page ? 'Omnidoc page elapsed' : 'Omnidoc elapsed', ms(summary.elapsed), 'trt-total')];
  if (!summary.phases.length) {
    out.push('<div class="trt-note">This run recorded only the Omnidoc total. Phase and model-call timings require a new run.</div>');
    return out.join('');
  }
  out.push(...summary.phases.map((phase) => row(phase.label, ms(phase.ms))));
  out.push(row('Model calls (including queue)', `${summary.calls} · ${ms(summary.callMs)}`),
    row('of which queued', ms(summary.wait)), row('Cached answers', String(summary.cached)),
    row('Correction retries', String(summary.retries)));
  out.push('<details><summary>Omnidoc model questions</summary>',
    ...summary.questions.map((q) => row(q.label, ms(q.ms))
      + row(`${q.calls} calls${q.cached ? ` · ${q.cached} cached` : ''}${q.retries ? ` · ${q.retries} retries` : ''}`, `${Math.round(q.wait)} ms queued`)),
    '</details>',
    `<div class="trt-note">${page ? 'Omnidoc runs after the page translation measured above.' : 'Omnidoc runs after page translation. Phase and call times sum parallel work; they are not extra elapsed time.'} Model calls are already included in interpretation and linking. Call time includes transport and waiting; it is not GPU execution time. Counts include failed calls and retries.</div>`);
  return out.join('');
}
