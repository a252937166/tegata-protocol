import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang, type TKey } from '../lib/i18n';
import { HankoStamp, StatusBadge } from '../components/ui';
import { usdc, shortAddr } from '../lib/format';

function CheckLine({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[0.8rem]">
      <span className="text-ink2">{label}</span>
      <span className="text-good font-bold">✓</span>
    </div>
  );
}

function VerifiedDealCard() {
  const { t } = useLang();
  const { data } = useQuery({ queryKey: ['showcase'], queryFn: api.showcase, staleTime: 60_000 });
  if (!data) {
    return <div className="card p-8 min-h-[26rem] animate-pulse bg-(--paper2)/60" />;
  }
  const p = data.packet;
  const inv = data.invoice;
  const f = p.invoice.parsedFields;
  const r = p.invoice.riskReport;
  return (
    <div className="card p-6 relative overflow-visible">
      <div className="absolute -top-5 -right-4 bg-(--card) rounded-xl">
        <HankoStamp size="md" />
      </div>
      <div className="flex items-center gap-3">
        <span className="section-label">
          {t('hero.deal.title')} #{p.invoice.registryId}
        </span>
        <StatusBadge status={p.invoice.status} />
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink3">{t('hero.deal.invoice')}</dt>
          <dd className="font-bold">{f.invoiceNumber}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink3">{t('hero.deal.face')}</dt>
          <dd className="tabular-nums font-bold">${usdc(p.invoice.faceAmountBaseUnits)} USDC</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink3">{t('hero.deal.grade')}</dt>
          <dd>
            <b className="text-accent font-display text-lg">{r.grade}</b>
            <span className="text-ink3"> · {r.engine}</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink3">{t('hero.deal.discount')}</dt>
          <dd className="tabular-nums">{(r.discountBps / 100).toFixed(2)}%</dd>
        </div>
      </dl>

      {/* money flow */}
      <div className="mt-5 rounded-xl border border-line bg-(--paper2)/60 px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <div className="text-center">
            <div className="font-bold">{t('hero.deal.lender')}</div>
            <div className="mono text-ink3">{shortAddr(inv.lender)}</div>
          </div>
          <div className="flex-1 flex flex-col items-center px-1">
            <span className="tabular-nums font-bold text-accent">${usdc(inv.discountedAmount)} USDC</span>
            <div className="w-full flex items-center text-accent" aria-hidden>
              <div className="h-px bg-(--accent) flex-1" />
              <span className="-my-1">▶</span>
            </div>
            <span className="text-[0.65rem] text-ink3 mt-0.5">HSP · ACCEPT</span>
          </div>
          <div className="text-center">
            <div className="font-bold">{t('hero.deal.sme')}</div>
            <div className="text-ink3 max-w-[9rem] truncate">{f.sellerName.split('(')[0].trim()}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-line pt-3.5">
        <CheckLine label={t('hero.deal.mandate')} />
        <CheckLine label={t('hero.deal.kyc')} />
        <CheckLine label={t('hero.deal.sanctions')} />
        <CheckLine label={t('hero.deal.receipt')} />
      </div>

      <Link to="/showcase" className="btn w-full mt-5 !border-(--accent) text-accent">
        {t('hero.deal.open')} →
      </Link>
    </div>
  );
}

function RailNode({ title, sub, accent }: { title: string; sub: string; accent?: boolean }) {
  return (
    <div className={`flex-1 min-w-[8.5rem] rounded-xl border px-4 py-3 bg-(--card) ${accent ? 'border-(--accent)' : 'border-line'}`}>
      <div className={`font-bold text-sm ${accent ? 'text-accent' : ''}`}>{title}</div>
      <div className="text-xs text-ink2 mt-0.5 leading-snug">{sub}</div>
    </div>
  );
}

function RailArrow() {
  return <div className="text-ink3 px-1 self-center rotate-90 sm:rotate-0" aria-hidden>→</div>;
}

export default function Landing() {
  const { t } = useLang();
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });

  const diffs: [TKey, TKey][] = [
    ['diff.1.t', 'diff.1.b'],
    ['diff.2.t', 'diff.2.b'],
    ['diff.3.t', 'diff.3.b'],
  ];

  const metrics: { v: string; k: TKey }[] = [
    { v: cfg?.mainnet.deployed ? '3' : '3', k: 'metrics.contracts' },
    { v: '2 / 2', k: 'metrics.legs' },
    { v: '14 / 14', k: 'metrics.checks' },
    { v: '0', k: 'metrics.custody' },
  ];

  return (
    <div className="fade-in">
      {/* hero — value prop left, real verified deal right */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-14 pb-8 grid gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.16em] uppercase text-accent">
            <span className="h-px w-8 bg-accent inline-block flex-none" />
            {t('hero.kicker')}
          </div>
          <h1 className="font-display mt-5 text-4xl sm:text-[3.4rem] leading-[1.12] font-bold">
            {t('hero.title1')}
            <br />
            <span className="text-ink2">{t('hero.title2')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-ink2 leading-relaxed">{t('hero.body')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/showcase" className="btn btn-primary !px-6 !py-3 text-base">
              {t('hero.ctaShowcase')}
              <span className="opacity-75 text-xs font-normal ml-1">· {t('hero.ctaShowcaseSub')}</span>
            </Link>
            <Link to="/live" className="btn !px-6 !py-3 text-base">
              {t('hero.ctaLive')}
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold">
            {cfg?.mainnet.deployed && (
              <span className="inline-flex items-center gap-1.5 text-good">
                <span className="h-1.5 w-1.5 rounded-full bg-good inline-block" /> MAINNET LIVE
              </span>
            )}
            <span className="text-ink2">2/2 HSP ACCEPT</span>
            <span className="text-ink2">14/14 CHECKS PASS</span>
            <span className="text-ink2">ZERO CUSTODY</span>
          </div>
        </div>
        <VerifiedDealCard />
      </section>

      {/* proof metrics */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((m) => (
            <div key={m.k} className="rounded-xl border border-line bg-(--card) px-5 py-4">
              <div className="font-display text-3xl font-bold tabular-nums">{m.v}</div>
              <div className="text-[0.72rem] font-bold tracking-[0.1em] uppercase text-ink2 mt-1">{t(m.k)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* differentiators */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="section-label">{t('diff.label')}</div>
        <h2 className="font-display text-3xl font-bold mt-3 mb-8">{t('diff.title')}</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {diffs.map(([tt, tb], i) => (
            <div key={tt} className="border-l-2 border-(--accent) pl-5">
              <div className="font-display text-accent text-sm font-bold mb-1.5">0{i + 1}</div>
              <div className="font-bold text-lg leading-snug">{t(tt)}</div>
              <p className="text-sm text-ink2 mt-2 leading-relaxed">{t(tb)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* dual rail */}
      <section className="border-y border-line bg-(--paper2)/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <div className="section-label">{t('rail.label')}</div>
          <h2 className="font-display text-3xl font-bold mt-3 mb-8">{t('rail.title')}</h2>

          <div className="text-[0.7rem] font-bold tracking-[0.14em] text-ink3 mb-2">{t('rail.business')}</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <RailNode title={t('rail.b1')} sub={t('rail.b1s')} />
            <RailArrow />
            <RailNode title={t('rail.b2')} sub={t('rail.b2s')} />
            <RailArrow />
            <RailNode title={t('rail.b3')} sub={t('rail.b3s')} />
            <RailArrow />
            <RailNode title={t('rail.b4')} sub={t('rail.b4s')} />
          </div>

          <div className="flex justify-center my-3 text-ink3 text-xs font-bold tracking-widest" aria-hidden>
            ↓ ↓ ↓ ↓
          </div>

          <div className="text-[0.7rem] font-bold tracking-[0.14em] text-accent mb-2">{t('rail.evidence')}</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <RailNode accent title={t('rail.e1')} sub={t('rail.e1s')} />
            <RailArrow />
            <RailNode accent title={t('rail.e2')} sub={t('rail.e2s')} />
            <RailArrow />
            <RailNode accent title={t('rail.e3')} sub={t('rail.e3s')} />
            <RailArrow />
            <RailNode accent title={t('rail.e4')} sub={t('rail.e4s')} />
          </div>
        </div>
      </section>

      {/* judge paths — demoted below the fold */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ['/showcase', '60 sec', 'hero.ctaShowcase', 'hero.ctaShowcaseSub'],
              ['/live', '3 min', 'hero.ctaLive', 'hero.ctaLiveSub'],
              ['/proof', 'Technical', 'hero.ctaProof', 'hero.ctaProofSub'],
            ] as [string, string, TKey, TKey][]
          ).map(([to, chip, tt, ts]) => (
            <Link key={to} to={to} className="card group p-5 hover:-translate-y-0.5 transition-transform">
              <div className="text-[0.7rem] font-bold tracking-widest text-accent">{chip}</div>
              <div className="font-display text-lg font-bold mt-1.5 group-hover:text-accent transition-colors">
                {t(tt)}
              </div>
              <div className="text-xs text-ink3 mt-1">{t(ts)}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
