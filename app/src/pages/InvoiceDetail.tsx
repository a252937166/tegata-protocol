import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { StatusBadge, Spinner, ExtLink, CopyText, CheckRow } from '../components/ui';
import { usdc, shortAddr, shortHash, tsToDate, isZeroHash } from '../lib/format';

const EXPLORER = 'https://testnet-explorer.hsk.xyz';
const HSP = 'https://hsp-hackathon.hashkeymerchant.com';

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const [showJson, setShowJson] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.invoice(id!),
    enabled: Boolean(id),
    refetchInterval: 12_000,
  });
  const packet = useQuery({
    queryKey: ['packet', id],
    queryFn: () => api.packet(id!),
    enabled: Boolean(id) && Boolean(data && !isZeroHash(data.invoice.fundingPaymentId)),
  });
  const verify = useMutation({ mutationFn: () => api.verify(id!) });

  if (isLoading || !data)
    return (
      <div className="mx-auto max-w-4xl px-6 py-24 flex items-center gap-3 text-ink2">
        <Spinner /> {t('common.loading')}
      </div>
    );

  const inv = data.invoice;
  const lifecycle = [
    { label: 'Registered', at: tsToDate(inv.createdAt, lang), done: true },
    {
      label: 'Funded',
      at: isZeroHash(inv.fundingPaymentId) ? '' : shortHash(inv.fundingPaymentId, 12),
      done: ['Funded', 'Repaid', 'Overdue'].includes(inv.status),
    },
    {
      label: 'Repaid',
      at: isZeroHash(inv.repaymentPaymentId) ? '' : shortHash(inv.repaymentPaymentId, 12),
      done: inv.status === 'Repaid',
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-14 fade-in">
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <div>
          <div className="section-label">Tegata #{inv.id}</div>
          <h1 className="font-display text-3xl font-bold mt-2">
            {inv.fields?.invoiceNumber ?? `Invoice #${inv.id}`}
          </h1>
        </div>
        <StatusBadge status={inv.status} />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.borrower')}</dt>
              <dd>
                <ExtLink href={`${EXPLORER}/address/${inv.borrower}`} className="mono">
                  {shortAddr(inv.borrower)}
                </ExtLink>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.lender')}</dt>
              <dd>
                {isZeroHash(inv.lender) ? (
                  '—'
                ) : (
                  <ExtLink href={`${EXPLORER}/address/${inv.lender}`} className="mono">
                    {shortAddr(inv.lender)}
                  </ExtLink>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.face')}</dt>
              <dd className="font-bold tabular-nums">${usdc(inv.faceAmount)} USDC</dd>
            </div>
            {inv.discountedAmount !== '0' && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink3">{t('live.pick.discounted')}</dt>
                <dd className="tabular-nums">${usdc(inv.discountedAmount)} USDC</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-ink3">{t('inv.due')}</dt>
              <dd>{tsToDate(inv.dueDate, lang)}</dd>
            </div>
            {inv.risk && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink3">{t('inv.risk')}</dt>
                <dd>
                  <b className="text-accent">{inv.risk.grade}</b> · {(inv.risk.discountBps / 100).toFixed(2)}% ·{' '}
                  <span className="text-ink3">{inv.risk.engine}</span>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card p-6">
          <div className="section-label mb-4">{t('inv.timeline')}</div>
          {lifecycle.map((s, i) => (
            <div key={s.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="step-dot !w-6 !h-6 !text-[10px]" data-state={s.done ? 'done' : undefined}>
                  {s.done ? '✓' : i + 1}
                </div>
                {i < lifecycle.length - 1 && <div className="w-px flex-1 bg-line my-1" />}
              </div>
              <div className="pb-5 min-w-0">
                <div className={`text-sm font-bold ${s.done ? '' : 'text-ink3'}`}>{s.label}</div>
                {s.at && <div className="text-xs text-ink3 mono truncate">{s.at}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6 mt-6">
        <div className="section-label mb-4">{t('inv.hashes')}</div>
        <dl className="space-y-2 text-xs">
          {(
            [
              ['invoiceHash', inv.invoiceHash],
              ['riskReportHash', inv.riskReportHash],
              ['fundingPaymentId', inv.fundingPaymentId],
              ['repaymentPaymentId', inv.repaymentPaymentId],
              ['packetHash', inv.packetHash],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between items-center gap-2">
              <dt className="text-ink3">{label}</dt>
              <dd className="flex items-center gap-3">
                {isZeroHash(value) ? (
                  <span className="text-ink3">—</span>
                ) : (
                  <>
                    <CopyText text={value} display={shortHash(value, 18)} />
                    {label.endsWith('PaymentId') && (
                      <ExtLink href={`${HSP}/explorer?id=${value}`}>{t('common.hspExplorer')}</ExtLink>
                    )}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {packet.data && (
        <div className="card p-6 mt-6">
          <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
            <div className="section-label">{t('inv.packet')}</div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => setShowJson((s) => !s)}>
                {showJson ? '– JSON' : '+ JSON'}
              </button>
              <a
                className="btn"
                href={`data:application/json;charset=utf-8,${encodeURIComponent(
                  JSON.stringify(packet.data.packet, null, 2),
                )}`}
                download={`tegata-${inv.id}-compliance-packet.json`}
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
              {verify.data.checks.map((c) => (
                <CheckRow key={c.label} pass={c.pass} label={c.label} />
              ))}
            </div>
          )}
          {showJson && <pre className="json-view fade-in">{JSON.stringify(packet.data.packet, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
