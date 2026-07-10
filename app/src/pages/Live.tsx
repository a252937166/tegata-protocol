import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useAccount,
  useBalance,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from 'wagmi';
import { hashTypedData } from 'viem';
import { hashkeyTestnet, ERC20_ABI } from '../lib/wagmi';
import { api, type ApiInvoice, type InvoiceFields, type RiskReport } from '../lib/api';
import { useLang, type TKey } from '../lib/i18n';
import { Spinner, StatusBadge, ExtLink, CopyText, HankoStamp } from '../components/ui';
import { usdc, shortAddr, shortHash, tsToDate } from '../lib/format';

const SAMPLE_DOC = () =>
  JSON.stringify(
    {
      documentType: 'invoice',
      invoiceNumber: `AOI-2026-${String(Date.now()).slice(-6)}`,
      seller: 'Aoi Textile Works K.K. (Kyoto)',
      payer: 'Umeda Trading Co., Ltd.',
      description: 'Indigo-dyed fabric rolls, summer lot',
      amount: '1.40',
      currency: 'USDC',
      issueDate: new Date().toISOString().slice(0, 10),
      termDays: 45,
      paymentTerms: 'NET-45, replacing paper tegata workflow',
      note: 'Demo document for the TEGATA Protocol hackathon build. Not a real receivable.',
    },
    null,
    2,
  );

function IssuePanel() {
  const { t } = useLang();
  const qc = useQueryClient();
  const [doc, setDoc] = useState(SAMPLE_DOC);
  const [busy, setBusy] = useState<'idle' | 'underwriting' | 'registering'>('idle');
  const [error, setError] = useState('');
  const [underwrote, setUnderwrote] = useState<{
    fields: InvoiceFields;
    risk: RiskReport;
    invoiceHash: string;
    riskReportHash: string;
  } | null>(null);
  const [registered, setRegistered] = useState<{ registerTx: string; invoice: ApiInvoice } | null>(null);

  async function underwrite() {
    setBusy('underwriting');
    setError('');
    setRegistered(null);
    try {
      setUnderwrote(await api.underwrite(doc));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }
  async function register() {
    setBusy('registering');
    setError('');
    try {
      const r = await api.issue(doc);
      setRegistered({ registerTx: r.registerTx, invoice: r.invoice });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  return (
    <div className="card p-6 mt-14">
      <div className="section-label">{t('issue.title')}</div>
      <p className="text-sm text-ink2 mt-2.5 mb-4 leading-relaxed">{t('issue.sub')}</p>
      <textarea
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        rows={8}
        spellCheck={false}
        className="w-full mono text-xs rounded-xl border border-line bg-(--paper2)/60 p-4 outline-none focus:border-(--accent) transition-colors resize-y"
      />
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn btn-primary" disabled={busy !== 'idle'} onClick={underwrite}>
          {busy === 'underwriting' ? (
            <>
              <Spinner /> {t('issue.running')}
            </>
          ) : (
            t('issue.run')
          )}
        </button>
        {underwrote && (
          <button className="btn" disabled={busy !== 'idle'} onClick={register}>
            {busy === 'registering' ? (
              <>
                <Spinner /> {t('issue.registering')}
              </>
            ) : (
              t('issue.register')
            )}
          </button>
        )}
      </div>
      {error && <div className="text-sm text-bad mt-3 break-all">{error}</div>}

      {underwrote && (
        <div className="grid gap-4 md:grid-cols-2 mt-5 fade-in">
          <div className="rounded-xl border border-line bg-(--paper2)/50 p-5">
            <div className="section-label mb-3">{t('issue.parsed')}</div>
            <dl className="space-y-1.5 text-xs">
              {(
                [
                  ['invoice #', underwrote.fields.invoiceNumber],
                  ['seller', underwrote.fields.sellerName],
                  ['payer', underwrote.fields.payerName],
                  ['face', `$${usdc(underwrote.fields.amountBaseUnits)} ${underwrote.fields.currency}`],
                  ['term', `${underwrote.fields.termDays} days`],
                  ['confidence', underwrote.fields.confidence.toFixed(2)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink3">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl border border-line bg-(--paper2)/50 p-5">
            <div className="section-label mb-3">{t('issue.risk')}</div>
            <div className="flex items-baseline gap-5">
              <span className="font-display text-4xl font-bold text-accent">{underwrote.risk.grade}</span>
              <span className="font-display text-xl font-bold tabular-nums">
                {(underwrote.risk.discountBps / 100).toFixed(2)}%
              </span>
              <span className="ml-auto text-xs text-ink3">
                {t('issue.engine')}: <b>{underwrote.risk.engine}</b>
              </span>
            </div>
            <p className="text-xs text-ink2 mt-3 leading-relaxed">{underwrote.risk.rationale}</p>
          </div>
          <div className="md:col-span-2 rounded-xl border border-line bg-(--paper2)/50 p-5">
            <div className="section-label mb-3">{t('issue.onchain')}</div>
            <dl className="space-y-1.5 text-xs">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <dt className="text-ink3">invoiceHash</dt>
                <dd>
                  <CopyText text={underwrote.invoiceHash} display={shortHash(underwrote.invoiceHash, 22)} />
                </dd>
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2">
                <dt className="text-ink3">riskReportHash</dt>
                <dd>
                  <CopyText text={underwrote.riskReportHash} display={shortHash(underwrote.riskReportHash, 22)} />
                </dd>
              </div>
              {registered && (
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <dt className="text-ink3">register tx</dt>
                  <dd className="flex items-center gap-3">
                    <ExtLink href={`https://testnet-explorer.hsk.xyz/tx/${registered.registerTx}`} className="mono">
                      {shortHash(registered.registerTx, 16)}
                    </ExtLink>
                    <span className="badge badge-repaid">✓ Tegata #{registered.invoice.id}</span>
                  </dd>
                </div>
              )}
            </dl>
            {registered && <p className="text-xs text-good font-semibold mt-3">{t('issue.registered')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

type FundPhase = 'idle' | 'preparing' | 'signing' | 'broadcast' | 'observing' | 'done' | 'error';

function StepShell({
  n,
  state,
  title,
  children,
}: {
  n: number;
  state: 'todo' | 'active' | 'done';
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex gap-4 ${state === 'todo' ? 'opacity-45' : ''}`}>
      <div className="flex flex-col items-center">
        <div className="step-dot" data-state={state === 'todo' ? undefined : state}>
          {state === 'done' ? '✓' : n}
        </div>
        <div className="w-px flex-1 bg-line my-1.5" />
      </div>
      <div className="pb-8 flex-1 min-w-0">
        <div className="font-bold text-[0.95rem] mt-1.5">{title}</div>
        {state !== 'todo' && <div className="mt-2.5">{children}</div>}
      </div>
    </div>
  );
}

export default function Live() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const onNetwork = isConnected && chainId === hashkeyTestnet.id;

  const { data: cfgData } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });
  const { data: invData } = useQuery({ queryKey: ['invoices'], queryFn: api.invoices, refetchInterval: 12_000 });
  const { data: kyc, refetch: refetchKyc } = useQuery({
    queryKey: ['kyc', address],
    queryFn: () => api.kycCheck(address!),
    enabled: Boolean(address),
  });
  const { data: gasBal } = useBalance({ address, chainId: hashkeyTestnet.id, query: { refetchInterval: 8000 } });
  const { data: usdcBal, refetch: refetchUsdc } = useReadContract({
    abi: ERC20_ABI,
    address: cfgData?.stablecoin.address,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: hashkeyTestnet.id,
    query: { enabled: Boolean(address && cfgData), refetchInterval: 8000 },
  });

  const [claiming, setClaiming] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const [picked, setPicked] = useState<ApiInvoice | null>(null);
  const [phase, setPhase] = useState<FundPhase>('idle');
  const [fundError, setFundError] = useState('');
  const [result, setResult] = useState<{
    paymentId: string;
    anchorTx: string;
    hspExplorerUrl: string;
    invoice: ApiInvoice;
  } | null>(null);
  const [repaying, setRepaying] = useState(false);
  const [repayResult, setRepayResult] = useState<{ hspExplorerUrl: string; invoice: ApiInvoice } | null>(null);

  const openInvoices = useMemo(() => {
    // hide invoices another visitor is actively funding (soft reservation);
    // keep the one THIS visitor picked visible even while reserved for them
    const mineOrFree = (i: ApiInvoice) =>
      !i.reserved || (address && i.reservedBy?.toLowerCase() === address.toLowerCase());
    const list = (invData?.invoices ?? []).filter((i) => i.status === 'Registered' && i.fields && mineOrFree(i));
    if (picked && picked.status === 'Registered' && !list.some((i) => i.id === picked.id)) list.unshift(picked);
    return list;
  }, [invData, picked, address]);

  const hasFunds = (gasBal?.value ?? 0n) > 0n && ((usdcBal as bigint | undefined) ?? 0n) > 0n;
  const kycOk = Boolean(kyc?.ok);

  async function claimFunds() {
    if (!address) return;
    setClaiming(true);
    try {
      await api.faucet(address);
      await new Promise((r) => setTimeout(r, 3500));
      await refetchUsdc();
    } finally {
      setClaiming(false);
    }
  }
  async function issueKyc() {
    if (!address) return;
    setAttesting(true);
    try {
      await api.kycAttest(address);
      await refetchKyc();
    } finally {
      setAttesting(false);
    }
  }

  // guards against a stale run overwriting state after the user cancels
  const runRef = useRef(0);

  // Switching wallet accounts resets the flow — the page must never mix two
  // identities. Exception: once the settlement is broadcast (funds in flight
  // for the previous account), the run is allowed to finish so the transfer
  // doesn't become an orphan; the evidence panel names the actual lender.
  const prevAddress = useRef(address);
  useEffect(() => {
    if (prevAddress.current && address && address !== prevAddress.current) {
      if (phase !== 'broadcast' && phase !== 'observing') {
        runRef.current++; // orphan any pre-broadcast run (nothing on-chain yet)
        setPhase('idle');
        setPicked(null);
        setResult(null);
        setRepayResult(null);
        setFundError('');
      }
    }
    prevAddress.current = address;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function fund() {
    if (!address || !walletClient || !picked) return;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    setFundError('');
    try {
      setPhase('preparing');
      const prepared = await api.prepare(address, picked.id, 'funding');
      if (!alive()) return;

      setPhase('signing');
      const typedData = prepared.toSign[0].params.typedData as Parameters<typeof hashTypedData>[0];
      // client-side integrity check before asking the wallet to sign
      if (hashTypedData(typedData).toLowerCase() !== prepared.paymentId.toLowerCase()) {
        throw new Error('typed-data digest does not match paymentId — refusing to sign');
      }
      const mandateSignature = await walletClient.signTypedData(typedData as never);
      if (!alive()) return;

      setPhase('broadcast');
      const tx = prepared.toSign[1].params.tx;
      const txHash = await walletClient.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0n,
        chain: hashkeyTestnet,
      });
      if (!alive()) return;

      setPhase('observing');
      const submitted = await api.submit({
        invoiceId: picked.id,
        leg: 'funding',
        paymentId: prepared.paymentId,
        mandateBody: prepared.mandateBody,
        mandateSignature,
        txHash,
      });
      if (!alive()) return;
      setResult(submitted);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      refetchUsdc();
    } catch (e) {
      if (!alive()) return;
      setFundError((e as Error).message);
      setPhase('error');
    }
  }

  function cancelFund() {
    runRef.current++; // orphan the in-flight run; late wallet approval is ignored
    setPhase('idle');
    setFundError('');
  }

  async function repay() {
    if (!result) return;
    setRepaying(true);
    try {
      const r = await api.repay(result.invoice.id);
      setRepayResult(r);
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      setFundError((e as Error).message);
    } finally {
      setRepaying(false);
    }
  }

  function reset() {
    setPicked(null);
    setPhase('idle');
    setResult(null);
    setRepayResult(null);
    setFundError('');
  }

  const youPay = picked ? (BigInt(picked.faceAmount) * BigInt(10_000 - (picked.risk?.discountBps ?? 200))) / 10_000n : 0n;

  const provesItems: { k: TKey; lit: boolean }[] = [
    { k: 'live.proves.1', lit: ['observing', 'done'].includes(phase) },
    { k: 'live.proves.2', lit: ['observing', 'done'].includes(phase) },
    { k: 'live.proves.3', lit: phase === 'done' },
    { k: 'live.proves.4', lit: phase === 'done' },
    { k: 'live.proves.5', lit: phase === 'done' },
    { k: 'live.proves.6', lit: phase === 'done' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 fade-in lg:grid lg:grid-cols-[1fr_270px] lg:gap-12">
      <div className="max-w-3xl">
      <div className="section-label">{t('nav.live')}</div>
      <h1 className="font-display text-4xl font-bold mt-3">{t('live.title')}</h1>
      <p className="text-ink2 mt-3 leading-relaxed">{t('live.sub')}</p>

      <div className="mt-10">
        {/* 1 connect */}
        <StepShell n={1} state={isConnected ? 'done' : 'active'} title={t('live.step1')}>
          <p className="text-sm text-ink2 mb-3">{t('live.connect.b')}</p>
          {!isConnected && (
            <button className="btn btn-primary" disabled={connecting} onClick={() => connect({ connector: connectors[0] })}>
              {connecting ? <Spinner /> : null} {t('wallet.connect')}
            </button>
          )}
        </StepShell>

        {/* 2 network */}
        <StepShell n={2} state={onNetwork ? 'done' : isConnected ? 'active' : 'todo'} title={t('live.step2')}>
          <p className="text-sm text-ink2 mb-3">{t('live.network.b')}</p>
          {onNetwork ? (
            <div className="text-sm text-good font-semibold">✓ {t('live.network.ok')}</div>
          ) : (
            <button className="btn btn-primary" disabled={switching} onClick={() => switchChain({ chainId: hashkeyTestnet.id })}>
              {switching ? <Spinner /> : null} {t('live.network.switch')}
            </button>
          )}
        </StepShell>

        {/* 3 funds + kyc — one combined action */}
        <StepShell
          n={3}
          state={hasFunds && kycOk ? 'done' : onNetwork ? 'active' : 'todo'}
          title={t('live.step3')}
        >
          <p className="text-sm text-ink2 mb-3">{t('live.funds.b')}</p>
          {!(hasFunds && kycOk) && (
            <button
              className="btn btn-primary"
              disabled={claiming || attesting}
              onClick={async () => {
                if (!hasFunds) await claimFunds();
                if (!kycOk) await issueKyc();
              }}
            >
              {claiming || attesting ? <Spinner /> : null} {t('live.prepare')}
            </button>
          )}
          <div className="mt-3 space-y-1 text-sm">
            <div className={`flex items-center gap-2 ${hasFunds ? 'text-good' : 'text-ink3'}`}>
              <span className="font-bold w-4">{hasFunds ? '✓' : claiming ? '…' : '○'}</span> {t('live.prepare.f')}
            </div>
            <div className={`flex items-center gap-2 ${kycOk ? 'text-good' : 'text-ink3'}`}>
              <span className="font-bold w-4">{kycOk ? '✓' : attesting ? '…' : '○'}</span> {t('live.prepare.k')}
            </div>
          </div>
          {address && (
            <div className="text-xs text-ink3 mt-3 tabular-nums">
              {t('live.funds.balance')}: {gasBal ? (Number(gasBal.value) / 1e18).toFixed(4) : '…'} HSK ·{' '}
              {usdcBal !== undefined ? usdc(usdcBal as bigint) : '…'} USDC
              {kyc && kycOk ? ` · KYC: ${kyc.modeLabel}` : ''}
            </div>
          )}
        </StepShell>

        {/* 4 pick invoice */}
        <StepShell n={4} state={picked ? 'done' : hasFunds && kycOk ? 'active' : 'todo'} title={t('live.step4')}>
          <p className="text-sm text-ink2 mb-3">{t('live.pick.b')}</p>
          <div className="grid gap-3">
            {openInvoices.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setPicked(inv)}
                className={`card p-4 text-left transition-all cursor-pointer hover:-translate-y-0.5 ${
                  picked?.id === inv.id
                    ? '!border-(--accent) !border-2 !bg-(--accent-soft)'
                    : picked
                      ? 'opacity-50 hover:opacity-90'
                      : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-sm">{inv.fields!.invoiceNumber}</span>
                  {picked?.id === inv.id ? (
                    <span className="badge" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}>
                      ✓ #{inv.id}
                    </span>
                  ) : (
                    <span className="badge badge-registered">#{inv.id}</span>
                  )}
                </div>
                <div className="text-xs text-ink2 mt-1">{inv.fields!.sellerName}</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mt-2.5 tabular-nums">
                  <span>
                    <span className="text-ink3">{t('live.pick.face')}</span> ${usdc(inv.faceAmount)}
                  </span>
                  <span>
                    <span className="text-ink3">{t('live.pick.due')}</span> {tsToDate(inv.dueDate, lang)}
                  </span>
                  <span>
                    <span className="text-ink3">{t('inv.risk')}</span>{' '}
                    <b className="text-accent">{inv.risk?.grade}</b> · {(inv.risk!.discountBps / 100).toFixed(2)}%
                  </span>
                </div>
              </button>
            ))}
            {openInvoices.length === 0 && <div className="text-sm text-ink3">{t('inv.none')}</div>}
          </div>
        </StepShell>

        {/* 5 fund */}
        <StepShell n={5} state={phase === 'done' ? 'done' : picked ? 'active' : 'todo'} title={t('live.step5')}>
          <p className="text-sm text-ink2 mb-3">{t('live.fund.b')}</p>
          {picked && phase !== 'done' && (
            <div className="card p-4 mb-3 text-sm flex items-center justify-between">
              <span>
                {picked.fields!.invoiceNumber} · <span className="text-ink3">{t('live.pick.discounted')}</span>
              </span>
              <span className="font-display text-xl font-bold tabular-nums">${usdc(youPay)}</span>
            </div>
          )}
          {(phase === 'idle' || phase === 'error') && (
            <button className="btn btn-primary" onClick={fund}>
              {t('live.fund.go')}
            </button>
          )}
          {phase === 'error' && <div className="text-sm text-bad mt-3 break-all">{fundError}</div>}
          {['preparing', 'signing', 'broadcast', 'observing'].includes(phase) && (
            <div className="mt-2">
              <div className="flex items-center gap-2.5 text-sm text-ink2">
                <Spinner className="text-accent" />
                {phase === 'preparing' && t('live.fund.preparing')}
                {phase === 'signing' && t('live.fund.signing')}
                {phase === 'broadcast' && t('live.fund.broadcast')}
                {phase === 'observing' && t('live.fund.observing')}
                {phase !== 'observing' && (
                  <button className="btn btn-ghost !py-1 !px-2.5 text-xs" onClick={cancelFund}>
                    {t('live.fund.cancel')}
                  </button>
                )}
              </div>
              {(phase === 'signing' || phase === 'broadcast') && (
                <p className="text-xs text-ink3 mt-2 max-w-lg leading-relaxed">{t('live.fund.hint')}</p>
              )}
            </div>
          )}
        </StepShell>

        {/* 6 evidence */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="step-dot" data-state={phase === 'done' ? 'done' : undefined}>
              {phase === 'done' ? '✓' : 6}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[0.95rem] mt-1.5">{t('live.step6')}</div>
            {phase === 'done' && result && (
              <div className="mt-3 card p-5 fade-in border-(--good)/40">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-good font-display text-xl font-bold">✓ {t('live.done.title')}</div>
                    <div className="mt-2.5 space-y-1 text-sm text-ink2">
                      <div>✓ {t('live.accept.l1')}</div>
                      <div>✓ {t('live.accept.l2')}</div>
                      <div>✓ {t('live.accept.l3')}</div>
                    </div>
                  </div>
                  <HankoStamp size="md" />
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink3">paymentId</span>
                    <CopyText text={result.paymentId} display={shortHash(result.paymentId, 14)} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink3">lender of record</span>
                    <CopyText text={result.invoice.lender} display={shortAddr(result.invoice.lender)} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink3">status</span>
                    <StatusBadge status={repayResult?.invoice.status ?? result.invoice.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
                  <ExtLink href={result.hspExplorerUrl}>{t('common.hspExplorer')}</ExtLink>
                  <ExtLink href={`https://testnet-explorer.hsk.xyz/tx/${result.anchorTx}`}>anchor tx</ExtLink>
                  {repayResult && <ExtLink href={repayResult.hspExplorerUrl}>repayment · {t('common.hspExplorer')}</ExtLink>}
                </div>
                <p className="text-sm text-ink2 mt-4">{t('live.done.b')}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {!repayResult && (
                    <button className="btn" disabled={repaying} onClick={repay}>
                      {repaying ? (
                        <>
                          <Spinner /> {t('live.done.repaying')}
                        </>
                      ) : (
                        t('live.done.repay')
                      )}
                    </button>
                  )}
                  <a className="btn btn-primary" href={`/invoices/${result.invoice.id}`}>
                    {t('live.done.packet')}
                  </a>
                  <button className="btn btn-ghost" onClick={reset}>
                    {t('live.reset')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <IssuePanel />
      </div>

      {/* what this demo proves — sticky rail, lights up as the flow advances */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 card p-5">
          <div className="text-[0.7rem] font-bold tracking-[0.16em] text-accent mb-3">{t('live.proves.title')}</div>
          <ol className="space-y-2.5">
            {provesItems.map((it, i) => (
              <li
                key={it.k}
                className={`flex gap-2.5 text-[0.8rem] leading-snug transition-colors ${
                  it.lit ? 'text-good font-semibold' : 'text-ink3'
                }`}
              >
                <span className="font-bold w-4 flex-none">{it.lit ? '✓' : i + 1}</span>
                {t(it.k)}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
