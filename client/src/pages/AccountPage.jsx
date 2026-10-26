import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Trash2 } from 'lucide-react';
import { api, friendlyError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/UI';

export default function AccountPage() {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(''); // '' | 'password' | 'delete'
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function changePassword(event) {
    event.preventDefault();
    setBusy('password');
    setError('');
    setNotice('');
    try {
      await api('/auth/password', { method: 'POST', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '' });
      setNotice('Password changed. Other devices have been signed out.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function removeAccount(event) {
    event.preventDefault();
    setBusy('delete');
    setError('');
    setNotice('');
    try {
      await deleteAccount(deletePassword);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
      setBusy('');
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>Account</h1>
          <p>Signed in as {user.email}.</p>
        </div>
      </div>
      {error && (
        <Notice type="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}
      {notice && <Notice onClose={() => setNotice('')}>{notice}</Notice>}

      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SECURITY</div>
            <h2>Change password</h2>
          </div>
        </div>
        <form onSubmit={changePassword}>
          <div className="field-grid">
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                required
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                placeholder="At least 10 characters"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="button button-primary" disabled={Boolean(busy)}>
              <KeyRound size={17} /> {busy === 'password' ? 'Saving...' : 'Change password'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">DANGER ZONE</div>
            <h2>Delete account</h2>
          </div>
        </div>
        <p className="settings-intro">
          This permanently deletes your account, products, documents, service contacts and
          reminders. It cannot be undone.
        </p>
        {confirmDelete ? (
          <form onSubmit={removeAccount}>
            <label className="field">
              <span>Enter your password to confirm</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <div className="form-actions">
              <button className="button button-danger-soft" disabled={Boolean(busy)}>
                <Trash2 size={17} /> {busy === 'delete' ? 'Deleting...' : 'Delete my account'}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="button button-danger-soft" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={17} /> Delete account
          </button>
        )}
      </section>
    </div>
  );
}
