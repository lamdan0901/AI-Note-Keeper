import React from 'react';
import { X } from 'lucide-react';

import { MergeSummary } from '../../../../../packages/shared/auth/userDataMerge';

type AccountMergeDialogProps = {
  summary: MergeSummary;
  loading: boolean;
  onClose: () => void;
  onChoose: (strategy: 'cloud' | 'local' | 'both') => void;
};

export function AccountMergeDialog({
  summary,
  loading,
  onClose,
  onChoose,
}: AccountMergeDialogProps): JSX.Element {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog auth-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-dialog__header">
          <span className="auth-dialog__title">Choose your merge</span>
          <button
            className="modal-dialog__close-btn"
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p className="auth-dialog__copy">
          Local and account data both exist. Pick which version becomes your signed-in state.
        </p>
        <div className="auth-dialog__summary">
          <span>Local notes: {summary.sourceCounts.notes}</span>
          <span>Account notes: {summary.targetCounts.notes}</span>
          <span>Local subscriptions: {summary.sourceCounts.subscriptions}</span>
          <span>Account subscriptions: {summary.targetCounts.subscriptions}</span>
        </div>
        <div className="auth-dialog__actions">
          <button
            className="auth-dialog__submit"
            type="button"
            onClick={() => onChoose('cloud')}
            disabled={loading}
          >
            Use account data
          </button>
          <button
            className="auth-dialog__switch"
            type="button"
            onClick={() => onChoose('local')}
            disabled={loading}
          >
            Replace account with local
          </button>
          <button
            className="auth-dialog__switch"
            type="button"
            onClick={() => onChoose('both')}
            disabled={loading}
          >
            Keep both
          </button>
        </div>
      </div>
    </div>
  );
}
