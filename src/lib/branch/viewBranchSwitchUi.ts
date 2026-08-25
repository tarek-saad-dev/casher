/** Lightweight pub/sub for view-branch switch loading UI (no React in postSwitchClient). */

export type ViewBranchSwitchUiState = {
  active: boolean;
  label: string | null;
};

type Listener = (state: ViewBranchSwitchUiState) => void;

let state: ViewBranchSwitchUiState = { active: false, label: null };
const listeners = new Set<Listener>();

export function getViewBranchSwitchUiState(): ViewBranchSwitchUiState {
  return state;
}

export function setViewBranchSwitchUi(active: boolean, label?: string | null): void {
  state = {
    active,
    label: active ? label ?? null : null,
  };
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribeViewBranchSwitchUi(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
