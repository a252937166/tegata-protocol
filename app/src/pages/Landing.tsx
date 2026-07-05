import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang, type TKey } from '../lib/i18n';
import { StatTile } from '../components/ui';
import { usdc } from '../lib/format';

function ModeCard({ to, title, sub, n }: { to: string; title: string; sub: string; n: string }) {
  return (
    <Link to={to} className="card group relative overflow-hidden p-6 transition-transform hover:-translate-y-1">
      <div className="font-display text-5xl text-(--muted-soft) absolute right-4 top-2 select-none group-hover:text-(--accent-soft) transition-colors">
        {n}
      </div>
      <div className="font-display text-xl font-bold pr-10">{title}</div>
      <div className="text-sm text-ink2 mt-1.5">{sub}</div>
      <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
        <span className="group-hover:translate-x-0.5 transition-transform">→</span>
      </div>
    </Link>
  );
}

export default function Landing() {
  const { t, lang } = useLang();
  const { data } = useQuery({ queryKey: ['invoices'], queryFn: api.invoices, refetchInterval: 15_000 });

  const invoices = data?.invoices ?? [];
  const registered = invoices.length;
  const fundedVol = invoices
    .filter((i) => ['Funded', 'Repaid', 'Overdue'].includes(i.status))
    .reduce((s, i) => s + BigInt(i.discountedAmount || 0), 0n);
  const repaidVol = invoices
    .filter((i) => i.status === 'Repaid')
    .reduce((s, i) => s + BigInt(i.faceAmount || 0), 0n);

  const steps: [TKey, TKey][] = [
    ['how.1.t', 'how.1.b'],
    ['how.2.t', 'how.2.b'],
    ['how.3.t', 'how.3.b'],
    ['how.4.t', 'how.4.b'],
    ['how.5.t', 'how.5.b'],
  ];
  const trust: [TKey, TKey][] = [
    ['trust.b1.t', 'trust.b1.b'],
    ['trust.b2.t', 'trust.b2.b'],
    ['trust.b3.t', 'trust.b3.b'],
    ['trust.b4.t', 'trust.b4.b'],
  ];

  return (
    <div className="fade-in">
      {/* hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-10">
        <div className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase text-accent">
          <span className="h-px w-8 bg-accent inline-block" />
          {t('hero.kicker')}
        </div>
        <h1 className="font-display mt-5 text-4xl sm:text-6xl leading-[1.12] font-bold max-w-4xl">
          {t('hero.title1')}
          <br />
          <span className="text-ink2">{t('hero.title2')}</span>
        </h1>
        <p className={`mt-6 max-w-3xl text-ink2 leading-relaxed ${lang === 'ja' ? 'text-[0.95rem]' : ''}`}>
          {t('hero.body')}
        </p>
        <p className="mt-5 max-w-3xl font-display text-lg border-l-2 border-accent pl-4 italic">
          {t('hero.tagline')}
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <ModeCard to="/showcase" n="壱" title={t('hero.ctaShowcase')} sub={t('hero.ctaShowcaseSub')} />
          <ModeCard to="/live" n="弐" title={t('hero.ctaLive')} sub={t('hero.ctaLiveSub')} />
          <ModeCard to="/proof" n="参" title={t('hero.ctaProof')} sub={t('hero.ctaProofSub')} />
        </div>
      </section>

      {/* live stats */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="text-xs text-ink3 mb-3">{t('stats.title')}</div>
        <div className="flex flex-wrap gap-4">
          <StatTile label={t('stats.registered')} value={registered} />
          <StatTile label={t('stats.funded')} value={`$${usdc(fundedVol)}`} sub="USDC (test)" />
          <StatTile label={t('stats.repaid')} value={`$${usdc(repaidVol)}`} sub="USDC (test)" />
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
        <div className="section-label">{t('how.label')}</div>
        <h2 className="font-display text-3xl font-bold mt-3 mb-8">{t('how.title')}</h2>
        <div className="grid gap-4 md:grid-cols-5">
          {steps.map(([tt, tb], i) => (
            <div key={tt} className="card p-5 relative">
              <div className="font-display text-accent text-sm font-bold mb-2">{String(i + 1).padStart(2, '0')}</div>
              <div className="font-bold mb-1.5">{t(tt)}</div>
              <div className="text-xs text-ink2 leading-relaxed">{t(tb)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* trust model */}
      <section className="border-y border-line bg-(--paper2)/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <div className="section-label">{t('trust.label')}</div>
          <h2 className="font-display text-3xl font-bold mt-3 mb-8">{t('trust.title')}</h2>
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {trust.map(([tt, tb]) => (
              <div key={tt} className="flex gap-3.5">
                <span className="mt-1 h-5 w-5 flex-none rounded-md bg-accent/90 text-accent-ink flex items-center justify-center text-[11px] font-black">
                  ✓
                </span>
                <div>
                  <div className="font-bold">{t(tt)}</div>
                  <div className="text-sm text-ink2 mt-0.5 leading-relaxed">{t(tb)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
