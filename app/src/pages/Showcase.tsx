import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, liveReport, type VerificationCheck } from '../lib/api';
import { useLang, type TKey } from '../lib/i18n';
import { ExtLink, CopyText, CheckRow, Spinner, OfflineVerifyHint, HankoStamp } from '../components/ui';
import { usdc, shortAddr, shortHash } from '../lib/format';

// PASS/FAIL comes from the shared verification core's latest real run —
// this component renders the report, it never asserts an outcome itself
function ReceiptRow({ label, pass }: { label: string; pass: boolean | undefined }) {
  return (
    <div className="flex items-center justify-between text-[0.82rem] py-1">
      <span className="text-ink2">{label}</span>
      {pass === undefined ? (
        <span className="text-ink3 text-xs">…</span>
      ) : (
        <span className={`font-bold text-xs tracking-wider ${pass ? 'text-good' : 'text-bad'}`}>
          {pass ? 'PASS' : 'FAIL'}
        </span>
      )}
    </div>
  );
}

// the five per-leg checks the core actually runs, in display order
const LEG_CHECK_ROWS: [suffix: string, key: TKey][] = [
  ['-verifier', 'receipt.verifier'],
  ['-attestations', 'receipt.attest'],
  ['-commercial', 'receipt.commercial'],
  ['-evidence-hash', 'receipt.evidence'],
  ['-anchor', 'receipt.anchored'],
];

function LegReceipt({
  leg,
  explorer,
  checks,
}: {
  leg: {
    leg: string;
    paymentId: string;
    settlementChain: { name: string; chainId: number };
    hspExplorerUrl: string;
    anchor: { chainId: number; txHash: string };
    verifierDecision: { outcomeClass?: string };
  };
  explorer: string;
  checks: VerificationCheck[] | null;
}) {
  const { t } = useLang();
  const [tech, setTech] = useState(false);
  const chk = (suffix: string) => checks?.find((c) => c.id === `${leg.leg}${suffix}`)?.pass;
  return (
    <div className="rounded-xl border border-line bg-(--paper2)/50 p-5 relative">
      <div className="flex items-start justify-between gap-3">
        <span className="font-display font-bold text-lg capitalize">{leg.leg} settlement</span>
        {chk('-verifier') && <HankoStamp size="sm" label="ACCEPT" />}
      </div>
      <div className="mt-2 divide-y divide-(--line)">
        {LEG_CHECK_ROWS.map(([suffix, k]) => (
          <ReceiptRow key={k} label={t(k)} pass={chk(suffix)} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        <ExtLink href={leg.hspExplorerUrl}>{t('receipt.trace')}</ExtLink>
        {leg.anchor.txHash && <ExtLink href={`${explorer}/tx/${leg.anchor.txHash}`}>{t('receipt.anchor')}</ExtLink>}
      </div>
      <button className="btn btn-ghost !px-2 !py-1 text-xs mt-2" onClick={() => setTech((s) => !s)}>
        {t('receipt.technical')} {tech ? '▴' : '▾'}
      </button>
      {tech && (
        <dl className="mt-2 space-y-1.5 text-[0.7rem] fade-in">
          <div className="flex justify-between items-center gap-2">
            <dt className="text-ink3">paymentId</dt>
            <dd>
              <CopyText text={leg.paymentId} display={shortHash(leg.paymentId, 18)} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink3">settled on</dt>
            <dd>
              {leg.settlementChain.name} ({leg.settlementChain.chainId})
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink3">anchored on</dt>
            <dd>chainId {leg.anchor.chainId}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

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

  const { packet, invoice } = data;
  const inv = packet.invoice;
  const fields = inv.parsedFields;
  const risk = inv.riskReport;
  const funding = packet.hspSettlement.legs.find((l) => l.leg === 'funding');
  const repayment = packet.hspSettlement.legs.find((l) => l.leg === 'repayment');
  const explorer = 'https://testnet-explorer.hsk.xyz';
  // stale or errored reports render as pending — never as a live PASS
  const report = liveReport(data.verification);
  const chk = (id: string) => report?.checks.find((c) => c.id === id)?.pass;
  const agoMin = report ? Math.max(0, Math.round((Date.now() - Date.parse(report.verifiedAt)) / 60_000)) : 0;

  // each step is derived from chain-backed state, not asserted
  const timeline: [string, boolean][] = [
    ['Registered', true],
    ['Funded', Boolean(funding)],
    ['Repaid', invoice.status === 'Repaid'],
    ['Packet anchored', Boolean(chk('packet-hash'))],
  ];

  const packetItems: TKey[] = [
    'packet.i1',
    'packet.i2',
    'packet.i3',
    'packet.i4',
    'packet.i5',
    'packet.i6',
    'packet.i7',
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12 fade-in">
      {/* dossier header */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="section-label">{t('nav.showcase')}</div>
          <h1 className="font-display text-4xl font-bold mt-3">
            TEGATA #{inv.registryId} <span className="text-ink2">· {fields.invoiceNumber}</span>
          </h1>
          <p className="text-ink2 mt-2 max-w-2xl leading-relaxed text-sm">{t('showcase.sub')}</p>
        </div>
        {report?.allPass && <HankoStamp size="lg" />}
      </div>

      {/* lifecycle timeline */}
      <div className="card px-6 py-5 mt-8">
        <div className="flex items-center">
          {timeline.map(([s, done], i) => (
            <div key={s} className={`flex items-center ${i < timeline.length - 1 ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-black ${done ? 'bg-(--good-soft) text-good' : 'bg-(--paper2) text-ink3'}`}
                >
                  {done ? '✓' : '…'}
                </span>
                <span className="text-[0.68rem] font-bold text-ink2 whitespace-nowrap">{s}</span>
              </div>
              {i < timeline.length - 1 && <div className="flex-1 h-px bg-(--good) opacity-40 mx-2 -mt-5" />}
            </div>
          ))}
        </div>
        {report && (
          <p className="text-[0.68rem] text-ink3 mt-3 tabular-nums border-t border-line pt-2.5">
            {t('showcase.verifiedAt')} {agoMin} min ago ·{' '}
            {new Date(report.verifiedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC · block{' '}
            {report.blockNumber} · {report.passed}/{report.total}
          </p>
        )}
        {data.verification && !report && (
          <p className="text-[0.68rem] text-ink3 mt-3 border-t border-line pt-2.5">{t('verify.stale')}</p>
        )}
      </div>

      {/* money flow */}
      <div className="card px-6 py-5 mt-4">
        <div className="flex items-center gap-3 text-sm">
          <div className="text-center flex-none">
            <div className="font-bold">{t('hero.deal.lender')}</div>
            <div className="mono text-xs text-ink3">{shortAddr(invoice.lender)}</div>
          </div>
          <div className="flex-1 flex flex-col items-center">
            <span className="tabular-nums font-bold text-accent">
              ${usdc(invoice.discountedAmount)} USDC{chk('funding-verifier') ? ' · HSP ACCEPT' : ''}
            </span>
            <div className="w-full flex items-center text-accent" aria-hidden>
              <div className="h-px bg-(--accent) flex-1" />
              <span className="-my-1">▶</span>
            </div>
            <div className="w-full flex items-center text-good mt-1.5" aria-hidden>
              <span className="-my-1 -scale-x-100">▶</span>
              <div className="h-px bg-(--good) flex-1" />
            </div>
            <span className="tabular-nums font-bold text-good mt-1">
              ${usdc(inv.faceAmountBaseUnits)} USDC{chk('repayment-verifier') ? ' · HSP ACCEPT' : ''}
            </span>
          </div>
          <div className="text-center flex-none max-w-[11rem]">
            <div className="font-bold">{t('hero.deal.sme')}</div>
            <div className="text-xs text-ink3 truncate">{fields.sellerName}</div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* the receivable */}
        <div className="card p-6">
          <div className="section-label mb-4">{t('showcase.invoice')}</div>
          <dl className="space-y-2 text-sm">
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
              <div className="font-display text-3xl font-bold tabular-nums">{(risk.discountBps / 100).toFixed(2)}%</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-ink3 uppercase tracking-wider">{t('showcase.engine')}</div>
              <div className="text-sm font-semibold mt-1">{risk.engine}</div>
            </div>
          </div>
          <p className="text-sm text-ink2 mt-4 leading-relaxed border-t border-line pt-4">{risk.rationale}</p>
        </div>
      </div>

      {/* settlement legs as verification receipts */}
      <div className="card p-6 mt-6">
        <div className="section-label mb-5">{t('showcase.legs')}</div>
        <div className="grid gap-4 md:grid-cols-2">
          {funding && <LegReceipt leg={funding} explorer={explorer} checks={report?.checks ?? null} />}
          {repayment && <LegReceipt leg={repayment} explorer={explorer} checks={report?.checks ?? null} />}
        </div>
      </div>

      {/* compliance packet as a product */}
      <div className="card p-6 mt-6">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
          <div className="section-label">{t('packet.title')}</div>
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

        <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2 rounded-xl border border-line bg-(--paper2)/50 p-5">
          {packetItems.map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="text-accent font-bold" aria-hidden>▸</span>
              <span className="text-ink2">{t(k)}</span>
            </div>
          ))}
          <div className="sm:col-span-2 border-t border-line mt-2 pt-2.5 font-bold text-sm">
            {report ? (
              <span className={report.allPass ? 'text-good' : 'text-bad'}>
                {report.passed}/{report.total} {t('packet.checks')}
              </span>
            ) : (
              <span className="text-ink3">… {t('packet.checks')}</span>
            )}
          </div>
        </div>

        {verify.data && (
          <div className="rounded-xl border border-line bg-(--paper2)/50 p-5 my-4 fade-in">
            <div className="text-sm font-bold mb-2">{t('showcase.checksTitle')}</div>
            {verify.data.checks.map((c) => (
              <CheckRow key={c.id} pass={c.pass} label={c.label} />
            ))}
            <p className="text-[0.68rem] text-ink3 mt-2.5 tabular-nums">
              {new Date(verify.data.verifiedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC · block{' '}
              {verify.data.blockNumber}
            </p>
          </div>
        )}

        {showJson && <pre className="json-view fade-in mt-4">{JSON.stringify(packet, null, 2)}</pre>}

        <OfflineVerifyHint packetName="sample-compliance-packet.json" />
      </div>
    </div>
  );
}
