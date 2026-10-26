import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  BellRing,
  ChevronDown,
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const titles = {
  '/dashboard': 'Dashboard',
  '/products': 'My products',
  '/documents': 'Documents',
  '/reminders': 'Reminders',
  '/account': 'Account',
};

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const current = location.pathname.startsWith('/products/')
    ? location.pathname.endsWith('/new')
      ? 'Add a product'
      : 'Product details'
    : titles[location.pathname] || 'Roof';
  async function signOut() {
    await logout();
    navigate('/login');
  }
  return (
    <div className="app-layout">
      {open && (
        <button className="mobile-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      )}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-roof" />
          </div>
          <span>
            roof<span className="brand-period">.</span>
          </span>
          <button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={21} />
          </button>
        </div>
        <div className="sidebar-group-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <NavLink
            to="/dashboard"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <LayoutDashboard size={19} /> Overview
          </NavLink>
          <NavLink
            to="/products"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Archive size={19} /> My products
          </NavLink>
          <NavLink
            to="/documents"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <FileText size={19} /> Documents
          </NavLink>
          <NavLink
            to="/reminders"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <BellRing size={19} /> Reminders
          </NavLink>
          <NavLink
            to="/account"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <UserRound size={19} /> Account
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon">
              <ShieldCheck size={19} />
            </div>
            <strong>Safe under one roof</strong>
            <p>Your warranty documents and product details are private to your account.</p>
          </div>
          <button className="nav-link signout" onClick={signOut}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{current}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="topbar-support">
              <CircleHelp size={17} /> Your warranty companion
            </span>
            <div className="profile-avatar" title={user?.name}>
              {user?.name?.slice(0, 1).toUpperCase()}
            </div>
            <span className="profile-name">{user?.name?.split(' ')[0]}</span>
            <ChevronDown size={15} className="profile-chevron" />
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
