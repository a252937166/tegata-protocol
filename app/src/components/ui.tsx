import { useState, type ReactNode } from 'react';
import { useLang, type TKey } from '../lib/i18n';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const key = `status.${status}` as TKey;
  return <span className={`badge badge-${status.toLowerCase()}`}>{t(key) === key ? status : t(key)}</span>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card px-5 py-4 flex-1 min-w-[10rem]">
      <div className="text-[0.72rem] font-bold tracking-[0.14em] uppercase text-ink2">{label}</div>
      <div className="font-display text-3xl mt-1 tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-ink3 mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function ExtLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-info hover:underline underline-offset-2 ${className}`}
    >
      {children}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

export function CopyText({ text, display }: { text: string; display?: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="mono inline-flex items-center gap-1.5 text-ink2 hover:text-ink transition-colors cursor-pointer"
      title={copied ? t('common.copied') : t('common.copy')}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {display ?? text}
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-good" aria-hidden>
          <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 15V5a1 1 0 0 1 1-1h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

export function CheckRow({ pass, label }: { pass: boolean; label: string }) {
  const { t } = useLang();
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        className={`mt-0.5 inline-flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full text-[10px] font-black ${
          pass ? 'bg-(--good-soft) text-good' : 'bg-(--bad-soft) text-bad'
        }`}
      >
        {pass ? '✓' : '✕'}
      </span>
      <span className="text-sm text-ink2">
        <span className={`font-bold mr-1.5 ${pass ? 'text-good' : 'text-bad'}`}>
          {pass ? t('common.pass') : t('common.fail')}
        </span>
        {label}
      </span>
    </div>
  );
}
