import { NavLink, Link } from 'react-router-dom';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useLang } from '../lib/i18n';
import { shortAddr } from '../lib/format';

function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      className="btn btn-ghost !px-2.5 !py-1.5 text-sm font-bold"
      onClick={() => setLang(lang === 'en' ? 'ja' : 'en')}
      title="Language"
    >
      {lang === 'en' ? '日本語' : 'EN'}
    </button>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  return (
    <button
      className="btn btn-ghost !px-2.5 !py-1.5"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title="Theme"
    >
      {theme === 'dark' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function WalletButton() {
  const { t } = useLang();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button className="btn !py-1.5 mono text-xs" onClick={() => disconnect()} title={t('wallet.disconnect')}>
        <span className="h-1.5 w-1.5 rounded-full bg-good inline-block" />
        {shortAddr(address)}
      </button>
    );
  }
  return (
    <button
      className="btn btn-primary !py-1.5 text-sm"
      disabled={isPending}
      onClick={() => connect({ connector: connectors[0] })}
    >
      {t('wallet.connect')}
    </button>
  );
}

export default function Nav({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const { t } = useLang();
  const links = [
    { to: '/showcase', label: t('nav.showcase') },
    { to: '/live', label: t('nav.live') },
    { to: '/invoices', label: t('nav.invoices') },
    { to: '/proof', label: t('nav.proof') },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-(--paper)/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3 mr-2 min-w-0">
          <span className="hanko">手</span>
          <span className="font-display font-bold text-lg tracking-wide hidden sm:block">TEGATA</span>
        </Link>
        <nav className="flex items-center gap-0.5 overflow-x-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-accent bg-(--accent-soft)' : 'text-ink2 hover:text-ink hover:bg-(--muted-soft)'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LangToggle />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
