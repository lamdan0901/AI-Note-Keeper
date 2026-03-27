import React, { useState } from 'react';
import { X } from 'lucide-react';

type AuthDialogProps = {
  mode: 'login' | 'register';
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSwitchMode: () => void;
  onSubmit: (username: string, password: string) => Promise<void>;
};

export function AuthDialog({
  mode,
  loading,
  error,
  onClose,
  onSwitchMode,
  onSubmit,
}: AuthDialogProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const isRegister = mode === 'register';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError('');

    if (!username.trim() || !password) {
      setValidationError('Fields must be filled, they must not be left blank.');
      return;
    }
    if (isRegister && !confirmPassword) {
      setValidationError('Fields must be filled, they must not be left blank.');
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }
    await onSubmit(username.trim(), password);
  };

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
          <span className="auth-dialog__title">{isRegister ? 'Create account' : 'Sign in'}</span>
          <button
            className="modal-dialog__close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form className="auth-dialog__form" onSubmit={handleSubmit}>
          <label className="auth-dialog__label">
            Username
            <input
              className="auth-dialog__input"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </label>
          <label className="auth-dialog__label">
            Password
            <input
              className="auth-dialog__input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              disabled={loading}
            />
          </label>
          {isRegister && (
            <label className="auth-dialog__label">
              Confirm password
              <input
                className="auth-dialog__input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </label>
          )}
          {error && <p className="auth-dialog__error">{error}</p>}
          {validationError && <p className="auth-dialog__error">{validationError}</p>}
          {isRegister &&
            password &&
            confirmPassword &&
            password !== confirmPassword &&
            !validationError && <p className="auth-dialog__error">Passwords do not match.</p>}
          <div className="auth-dialog__actions">
            <button className="auth-dialog__submit" type="submit" disabled={loading}>
              {loading ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
            </button>
            <button
              className="auth-dialog__switch"
              type="button"
              onClick={() => {
                setValidationError('');
                onSwitchMode();
              }}
              disabled={loading}
            >
              {isRegister ? 'Use sign in instead' : 'Create a new account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
