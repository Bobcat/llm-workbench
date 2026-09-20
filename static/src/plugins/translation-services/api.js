// The API client of the translation-services plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  getPdfArtifactJson(requestId, artifact, options = {}) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifact)}`, options);
  },

  async testTranslationPrompt(payload) {
    return fetchJson('/api/prompts/test-translation', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async submitImageRequest(formData) {
    return fetchJson('/api/translation/requests', {
      method: 'POST',
      body: formData,
    });
  },

  async getImageRequest(requestId) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(requestId)}`);
  },

  async cancelImageRequest(requestId) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST'
    });
  },

  async retranslateImageRequest(sourceRequestId, body) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(sourceRequestId)}/retranslate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async rerenderImageRequest(sourceRequestId, body) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(sourceRequestId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async submitPdfRequest(formData) {
    return fetchJson('/api/pdf-translation/requests', {
      method: 'POST',
      body: formData,
    });
  },

  async listPdfRequests() {
    return fetchJson('/api/pdf-translation/requests');
  },

  async getPdfRequest(requestId) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}`);
  },

  async cancelPdfRequest(requestId) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST'
    });
  },

  async rerenderPdfRequest(sourceRequestId, body) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(sourceRequestId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async getPdfBenchmarkResults() {
    return fetchJson('/api/pdf-benchmark/results');
  },

  async getPdfBenchmarkTestset() {
    return fetchJson('/api/pdf-benchmark/testset');
  },

  async runPdfBenchmark(formData) {
    return fetchJson('/api/pdf-benchmark/run', {
      method: 'POST',
      body: formData,
    });
  },

  async getPdfBenchmarkRunDetail(docId, system, runId = '') {
    const query = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}${query}`);
  },

  async getPdfBenchmarkRunAnchors(docId, system, runId) {
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}/${encodeURIComponent(runId)}/anchors`);
  },

  async deletePdfBenchmarkCell(docId, system, targetLang = null) {
    const query = targetLang !== null ? `?target_lang=${encodeURIComponent(targetLang)}` : '';
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}${query}`, {
      method: 'DELETE',
    });
  },

  async listPdfRegressionFixtures() {
    return fetchJson('/api/pdf-regression/fixtures');
  },

  async getPdfAnatomy(name, lang, variant) {
    const seg = encodeURIComponent;
    return fetchJson(`/api/pdf-regression/fixtures/${seg(name)}/${seg(lang)}/${seg(variant)}/anatomy`);
  },

  async getPdfRegressionStatus(requestId) {
    return fetchJson(`/api/pdf-regression/status?request_id=${encodeURIComponent(requestId)}`);
  },

  async capturePdfRegression(body) {
    return fetchJson('/api/pdf-regression/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async runPdfRegression(body) {
    return fetchJson('/api/pdf-regression/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async acceptPdfRegression(body) {
    return fetchJson('/api/pdf-regression/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deletePdfRegressionFixture(name, lang, variant) {
    return fetchJson(
      `/api/pdf-regression/fixtures/${encodeURIComponent(name)}/${encodeURIComponent(lang)}/${encodeURIComponent(variant)}`,
      { method: 'DELETE' },
    );
  },

  async listPdfRegressionSubdirs() {
    return fetchJson('/api/pdf-regression/subdirs');
  },

  async addPdfRegressionTestset(body) {
    return fetchJson('/api/pdf-regression/add-testset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async getRegressionStatus(name) {
    return fetchJson(`/api/translation/regression/status?name=${encodeURIComponent(name || '')}`);
  },

  async addRegressionTestset(body) {
    return fetchJson('/api/translation/regression/testset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async captureRegressionFixture(body) {
    return fetchJson('/api/translation/regression/fixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async listRegressionFixtures() {
    return fetchJson('/api/translation/regression/fixtures');
  },

  async listRegressionSubdirs() {
    return fetchJson('/api/translation/regression/subdirs');
  },

  async runRegressionVariant(body) {
    return fetchJson('/api/translation/regression/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async resnapshotRegression(body) {
    return fetchJson('/api/translation/regression/resnapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deleteRegressionFixture(name, lang, variant) {
    const segments = [name, lang, variant].filter(Boolean).map(encodeURIComponent).join('/');
    return fetchJson(`/api/translation/regression/fixtures/${segments}`, { method: 'DELETE' });
  },

  async getTranslationPrompt(promptId) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`);
  },

  async createTranslationPrompt(body) {
    return fetchJson('/api/translation/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async updateTranslationPrompt(promptId, body) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deleteTranslationPrompt(promptId) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`, {
      method: 'DELETE',
    });
  },

  async getTranslationStatus() {
    return fetchJson('/api/translation/status');
  }
};
