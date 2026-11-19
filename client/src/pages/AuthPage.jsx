import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileCheck2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../lib/api';
import { Notice } from '../components/UI';

export default function AuthPage({ mode }) {
  const registerMode = mode === 'register';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (registerMode) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      navigate('/dashboard');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-showcase">
        <div className="auth-logo">
          <div className="brand-mark">
            <span className="brand-roof" />
          </div>
          <span>
            roof<span className="brand-period">.</span>
          </span>
        </div>
        <div className="auth-showcase-content">
          <div className="eyebrow light">
            <Sparkles size={15} /> THE SMARTER WAY TO KEEP COVERED
          </div>
          <h1>
            Everything you own,
            <br />
            <em>under one roof.</em>
          </h1>
          <p>
            Bills, warranty cards and important dates — beautifully organized and always within
            reach.
          </p>
          <div className="auth-feature-stack">
            <div>
              <span>
                <FileCheck2 size={20} />
              </span>
              <div>
                <strong>Keep your proof close</strong>
                <small>Important documents, safely stored online.</small>
              </div>
            </div>
            <div>
              <span>
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Stay a step ahead</strong>
                <small>Know what is covered and what expires soon.</small>
              </div>
            </div>
          </div>
        </div>
        <div className="auth-showcase-footer">BUILT FOR THE THINGS THAT MATTER</div>
        <div className="showcase-orb orb-one" />
        <div className="showcase-orb orb-two" />
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-logo">
            <div className="brand-mark">
              <span className="brand-roof" />
            </div>{' '}
            roof<span className="brand-period">.</span>
          </div>
          <div className="auth-intro">
            <div className="eyebrow">WELCOME TO ROOF</div>
            <h2>{registerMode ? 'Create your account' : 'Welcome back'}</h2>
            <p>
              {registerMode
                ? 'A calmer way to keep track of everything you buy.'
                : 'Your warranties are right where you left them.'}
            </p>
          </div>
          {error && (
            <Notice type="error" onClose={() => setError('')}>
              {error}
            </Notice>
          )}
          <form onSubmit={submit} className="auth-form">
            {registerMode && (
              <label className="field">
                <span>Full name</span>
                <div className="input-icon">
                  <Sparkles size={18} />
                  <input
                    name="name"
                    value={form.name}
                    onChange={update}
                    placeholder="Your name"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </div>
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <div className="input-icon">
                <Mail size={18} />
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={update}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
            </label>
            <label className="field">
              <span>Password</span>
              <div className="input-icon">
                <LockKeyhole size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={update}
                  placeholder={registerMode ? 'At least 10 characters' : 'Enter your password'}
                  required
                  minLength={registerMode ? 10 : undefined}
                  autoComplete={registerMode ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? 'Please wait...' : registerMode ? 'Create account' : 'Sign in'}{' '}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {registerMode ? 'Already have an account?' : 'New to Roof?'}{' '}
            <Link to={registerMode ? '/login' : '/register'}>
              {registerMode ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <div className="auth-security">
            <ShieldCheck size={16} /> Private by default. Only you can see your products and
            documents.
          </div>
        </div>
      </section>
    </div>
  );
}
