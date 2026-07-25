/**
 * Sidebar activity signal.
 *
 * A view announces that it has work running so the shell can mark its sidebar entry, following
 * the same window-event idiom as the replay view's `llm-workbench:replay-status`. The state is
 * kept in the shell (app.js), not in the view: the point of the indicator is to be readable while
 * you are looking at a DIFFERENT view, and a view cannot answer for itself once it is unmounted.
 *
 * "Busy" means work that continues on its own — a request in flight, a replay running — not a
 * button that happens to be disabled for a moment.
 */
export const WORKFLOW_BUSY_EVENT = 'llm-workbench:workflow-busy';

export function publishWorkflowBusy(workflowId, busy) {
  window.dispatchEvent(new CustomEvent(WORKFLOW_BUSY_EVENT, {
    detail: { workflow: String(workflowId || ''), busy: Boolean(busy) },
  }));
}
