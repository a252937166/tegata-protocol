import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { StatusBadge, ExtLink, CopyText, CheckRow, Spinner } from '../components/ui';
import { usdc, shortHash } from '../lib/format';

export default function Showcase() {
  const { t } = useLang();
  const { data, isLoading, error } = useQuery({ queryKey: ['showcase'], queryFn: api.showcase });
  const [showJson, setShowJson] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.verify(data!.packet.invoice.registryId),
  });

  if (isLoading)
    return (
      <div className="mx-auto max-w-4xl px-6 py-24 flex items-center gap-3 text-ink2">
        <Spinner /> {t('common.loading')}
      </div>
    );
  if (error || !data) return <div className="mx-auto max-w-4xl px-6 py-24 text-bad">{t('common.error')}</div>;

  const { packet } = data;
  const inv = packet.invoice;
  const fields = inv.parsedFields;
  const risk = inv.riskReport;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 fade-in">
      <div className="section-label">{t('nav.showcase')}</div>
      <h1 className="font-display text-4xl font-bold mt-3">{t('showcase.title')}</h1>
      <p className="text-ink2 mt-3 max-w-3xl leading-relaxed">{t('showcase.sub')}</p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* the receivable */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="section-label">{t('showcase.invoice')}</div>
            <StatusBadge status={inv.status} />
          </div>
          <div className="font-display text-2xl font-bold">{fields.invoiceNumber}</div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">Seller</dt>
              <dd className="text-right">{fields.sellerName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">Payer</dt>
              <dd className="text-right">{fields.payerName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.face')}</dt>
              <dd className="font-bold tabular-nums">
                ${usdc(inv.faceAmountBaseUnits)} <span className="text-ink3 font-normal">{inv.currency}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.due')}</dt>
              <dd>{new Date(inv.dueDate).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between gap-4 items-center">
              <dt className="text-ink3">invoiceHash</dt>
              <dd>
                <CopyText text={inv.invoiceHash} display={shortHash(inv.invoiceHash, 14)} />
              </dd>
            </div>
          </dl>
        </div>

        {/* AI underwriting */}
        <div className="card p-6">
          <div className="section-label mb-4">{t('showcase.ai')}</div>
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-xs text-ink3 uppercase tracking-wider">{t('showcase.grade')}</div>
              <div className="font-display text-5xl font-bold text-accent">{risk.grade}</div>
            </div>
            <div>
              <div className="text-xs text-ink3 uppercase tracking-wider">{t('showcase.discount')}</div>
              <div className="font-display text-3xl font-bold tabular-nums">
                {(risk.discountBps / 100).toFixed(2)}%
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-ink3 uppercase tracking-wider">{t('showcase.engine')}</div>
              <div className="text-sm font-semibold mt-1">{risk.engine}</div>
            </div>
          </div>
          <p className="text-sm text-ink2 mt-4 leading-relaxed border-t border-line pt-4">{risk.rationale}</p>
        </div>
      </div>

      {/* settlement legs */}
      <div className="card p-6 mt-6">
        <div className="section-label mb-5">{t('showcase.legs')}</div>
        <div className="grid gap-4 md:grid-cols-2">
          {packet.hspSettlement.legs.map((leg) => (
            <div key={leg.paymentId} className="rounded-xl border border-line bg-(--paper2)/50 p-5">
              <div className="flex items-center justify-between">
                <span className="font-bold capitalize">{leg.leg}</span>
                <span
                  className={`badge ${leg.verifierDecision.outcomeClass === 'ACCEPT' ? 'badge-repaid' : 'badge-overdue'}`}
                >
                  {leg.verifierDecision.outcomeClass}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-ink3">paymentId</span>
                  <CopyText text={leg.paymentId} display={shortHash(leg.paymentId, 12)} />
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-ink3">settled on</span>
                  <span>
                    {leg.settlementChain.name} ({leg.settlementChain.chainId})
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-ink3">anchored on</span>
                  <span>chainId {leg.anchor.chainId}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <ExtLink href={leg.hspExplorerUrl}>{t('common.hspExplorer')}</ExtLink>
                {leg.anchor.txHash && (
                  <ExtLink href={`https://testnet-explorer.hsk.xyz/tx/${leg.anchor.txHash}`}>anchor tx</ExtLink>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* packet + verify */}
      <div className="card p-6 mt-6">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
          <div className="section-label">{t('showcase.packet')}</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setShowJson((s) => !s)}>
              {showJson ? '– JSON' : '+ JSON'}
            </button>
            <a
              className="btn"
              href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(packet, null, 2))}`}
              download={`tegata-${inv.registryId}-compliance-packet.json`}
            >
              {t('showcase.download')}
            </a>
            <button className="btn btn-primary" disabled={verify.isPending} onClick={() => verify.mutate()}>
              {verify.isPending ? (
                <>
                  <Spinner /> {t('showcase.verifying')}
                </>
              ) : (
                t('showcase.verify')
              )}
            </button>
          </div>
        </div>

        {verify.data && (
          <div className="rounded-xl border border-line bg-(--paper2)/50 p-5 mb-4 fade-in">
            <div className="text-sm font-bold mb-2">{t('showcase.checksTitle')}</div>
            {verify.data.checks.map((c) => (
              <CheckRow key={c.label} pass={c.pass} label={c.label} />
            ))}
          </div>
        )}

        {showJson && <pre className="json-view fade-in">{JSON.stringify(packet, null, 2)}</pre>}
      </div>
    </div>
  );
}
