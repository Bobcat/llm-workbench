import { createDialogDragController } from '../../../foundation/spa-foundation/index.js';
import { publishWorkflowBusy } from '../../shared/workflow-activity.js';

// The sidebar indicator is the shell's business. Announce that a replay is running rather than
// teaching the shell about this view's status values.
const REPLAY_WORKFLOW_ID = 'replay-translate';

function formatStatusLabel(status) {
  const normalized = String(status || 'idle').toLowerCase();
  if (normalized === 'idle') return 'Idle';
  if (normalized === 'playing') return 'Playing';
  if (normalized === 'paused') return 'Paused';
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'error') return 'Error';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function statusClassToken(status) {
  return String(status || 'idle')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

export function setStatusBadge(container, status) {
  const badge = container.querySelector('#replayStatusBadge');
  if (!badge) return;
  const normalized = String(status || 'idle').toLowerCase();
  badge.textContent = formatStatusLabel(normalized);
  badge.className = `replay-status-badge status-${statusClassToken(normalized)}`;
  publishWorkflowBusy(REPLAY_WORKFLOW_ID, normalized === 'playing');
}

export function syncSelectTitle(select) {
  if (!select) return;
  const selected = select.options[select.selectedIndex];
  select.title = selected ? selected.textContent || '' : '';
}

export function openDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('hidden');
}

export function closeDialog(dialog) {
  if (!dialog) return;
  if (dialog.classList.contains('hidden')) return;
  dialog.classList.add('hidden');
}

export function attachDialogDrag(dialogCard, dragHandle) {
  if (!dialogCard || !dragHandle) return;
  const drag = createDialogDragController((x, y) => {
    dialogCard.style.setProperty('--drag-x', `${x}px`);
    dialogCard.style.setProperty('--drag-y', `${y}px`);
  });
  dragHandle.addEventListener('mousedown', drag.onMouseDown);
}
