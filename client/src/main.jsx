import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import { Loading } from './components/UI';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import ProductFormPage from './pages/ProductFormPage';
import ProductDetailPage from './pages/ProductDetailPage';
import RemindersPage from './pages/RemindersPage';
import DocumentsPage from './pages/DocumentsPage';
import AccountPage from './pages/AccountPage';
import './styles.css';

function Protected() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="boot-loading">
        <Loading />
      </div>
    );
  return user ? <AppShell /> : <Navigate to="/login" replace />;
}

function Guest({ mode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="boot-loading">
        <Loading />
      </div>
    );
  return user ? <Navigate to="/dashboard" replace /> : <AuthPage mode={mode} />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Guest mode="login" />} />
          <Route path="/register" element={<Guest mode="register" />} />
          <Route element={<Protected />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/new" element={<ProductFormPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/products/:id/edit" element={<ProductFormPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
