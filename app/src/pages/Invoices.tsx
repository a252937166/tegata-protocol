import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { StatusBadge, Spinner } from '../components/ui';
import { usdc, shortAddr, tsToDate } from '../lib/format';

export default function Invoices() {
  const { t, lang } = useLang();
  const { data, isLoading } = useQuery({ queryKey: ['invoices'], queryFn: api.invoices, refetchInterval: 12_000 });

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 fade-in">
      <div className="section-label">{t('nav.invoices')}</div>
      <h1 className="font-display text-4xl font-bold mt-3">{t('inv.title')}</h1>
      <p className="text-ink2 mt-3">{t('inv.sub')}</p>

      {isLoading && (
        <div className="flex items-center gap-3 text-ink2 mt-10">
          <Spinner /> {t('common.loading')}
        </div>
      )}

      <div className="mt-8 grid gap-3">
        {(data?.invoices ?? []).map((inv) => (
          <Link
            key={inv.id}
            to={`/invoices/${inv.id}`}
            className="card p-5 flex flex-wrap items-center gap-x-6 gap-y-2 hover:-translate-y-0.5 transition-transform"
          >
            <div className="font-display text-lg font-bold w-14 text-ink3">#{inv.id}</div>
            <div className="min-w-40 flex-1">
              <div className="font-bold text-sm">{inv.fields?.invoiceNumber ?? '(document off-chain)'}</div>
              <div className="text-xs text-ink3 mt-0.5">{inv.fields?.sellerName ?? shortAddr(inv.borrower)}</div>
            </div>
            <div className="text-sm tabular-nums">
              <span className="text-ink3 text-xs mr-1.5">{t('inv.face')}</span>
              <b>${usdc(inv.faceAmount)}</b>
            </div>
            <div className="text-sm">
              <span className="text-ink3 text-xs mr-1.5">{t('inv.due')}</span>
              {tsToDate(inv.dueDate, lang)}
            </div>
            {inv.risk && (
              <div className="text-sm">
                <span className="text-ink3 text-xs mr-1.5">{t('inv.risk')}</span>
                <b className="text-accent">{inv.risk.grade}</b>
              </div>
            )}
            <div className="ml-auto">
              <StatusBadge status={inv.status} />
            </div>
          </Link>
        ))}
        {data && data.invoices.length === 0 && <div className="text-ink3">{t('inv.none')}</div>}
      </div>
    </div>
  );
}
