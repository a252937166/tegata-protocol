import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import Footer from './components/Footer';
import Landing from './pages/Landing';
import Showcase from './pages/Showcase';
import Live from './pages/Live';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Proof from './pages/Proof';

export default function App() {
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem('tegata.theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tegata.theme', theme);
  }, [theme]);

  const { pathname } = useLocation();
  useEffect(() => {
    // block body on purpose: some wallet extensions wrap window.scrollTo to
    // return a Promise; a concise arrow would hand that to React as the
    // effect cleanup, which crashes the tree on the next route change
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav theme={theme} setTheme={setTheme} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/showcase" element={<Showcase />} />
          <Route path="/live" element={<Live />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/proof" element={<Proof />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
