import type { ModalWorkspace, ModalWorkspaceConfig, WorkspaceComparison } from './types'

/**
 * Decide whether newly entered tokens point somewhere else.
 *
 * IDs win when both sides have one; a differing name alongside a matching ID is
 * a rename, not a switch. Workspace names are editable in Modal's settings, so
 * comparing on them would report a rename as an account switch — and, worse,
 * would treat two genuinely different workspaces as the same one when they
 * happen to share a display name, silently skipping the rebuild.
 *
 * When either side lacks an ID the comparison falls back to names and reports
 * itself as unconfident, so the UI can hedge rather than assert what it cannot
 * prove.
 *
 * Lives in shared/ because both the main process (recording the workspace after
 * validation) and the renderer (deciding whether to warn) need the same answer.
 */
export function compareWorkspace(
  stored: ModalWorkspaceConfig | null | undefined,
  observed: ModalWorkspace | undefined
): WorkspaceComparison {
  if (!stored || (!stored.workspaceId && !stored.workspaceName)) return { kind: 'first-setup' }
  if (!observed) return { kind: 'same' }

  const from = stored.workspaceName || stored.workspaceId || 'unknown'

  if (stored.workspaceId && observed.id) {
    if (stored.workspaceId === observed.id) {
      return stored.workspaceName && stored.workspaceName !== observed.name
        ? { kind: 'renamed', from: stored.workspaceName, to: observed.name }
        : { kind: 'same' }
    }
    return { kind: 'changed', from, to: observed.name, confident: true }
  }

  if (stored.workspaceName && stored.workspaceName === observed.name) return { kind: 'same' }
  return { kind: 'changed', from, to: observed.name, confident: false }
}

export type WorkspaceLineState =
  | { kind: 'hidden' }
  | { kind: 'unknown' }
  | { kind: 'unprovisioned'; name: string }
  | { kind: 'ready'; name: string }

/**
 * What the Modal section of Settings should say about the current workspace.
 *
 * Split out from the component so the mapping is testable without a DOM: two
 * opaque secret fields otherwise give no indication of which account is
 * configured, and "not provisioned yet" is the only warning a user gets that
 * their next transcription will pay for a cold image and volume.
 */
export function workspaceLineState(
  modal: ModalWorkspaceConfig | null | undefined,
  hasTokens: boolean
): WorkspaceLineState {
  if (!hasTokens) return { kind: 'hidden' }
  if (!modal?.workspaceName) return { kind: 'unknown' }
  if (!modal.provisionedAt) return { kind: 'unprovisioned', name: modal.workspaceName }
  return { kind: 'ready', name: modal.workspaceName }
}
