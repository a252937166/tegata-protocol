import { useMemo, useState } from 'react';
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
import { api, type ApiInvoice } from '../lib/api';
import { useLang } from '../lib/i18n';
import { Spinner, StatusBadge, ExtLink, CopyText } from '../components/ui';
import { usdc, shortHash, tsToDate } from '../lib/format';

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

  const openInvoices = useMemo(
    () => (invData?.invoices ?? []).filter((i) => i.status === 'Registered' && i.fields),
    [invData],
  );

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

  async function fund() {
    if (!address || !walletClient || !picked) return;
    setFundError('');
    try {
      setPhase('preparing');
      const prepared = await api.prepare(address, picked.id, 'funding');

      setPhase('signing');
      const typedData = prepared.toSign[0].params.typedData as Parameters<typeof hashTypedData>[0];
      // client-side integrity check before asking the wallet to sign
      if (hashTypedData(typedData).toLowerCase() !== prepared.paymentId.toLowerCase()) {
        throw new Error('typed-data digest does not match paymentId — refusing to sign');
      }
      const mandateSignature = await walletClient.signTypedData(typedData as never);

      setPhase('broadcast');
      const tx = prepared.toSign[1].params.tx;
      const txHash = await walletClient.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0n,
        chain: hashkeyTestnet,
      });

      setPhase('observing');
      const submitted = await api.submit({
        invoiceId: picked.id,
        leg: 'funding',
        paymentId: prepared.paymentId,
        mandateBody: prepared.mandateBody,
        mandateSignature,
        txHash,
      });
      setResult(submitted);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      refetchUsdc();
    } catch (e) {
      setFundError((e as Error).message);
      setPhase('error');
    }
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

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-14 fade-in">
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

        {/* 3 funds + kyc */}
        <StepShell
          n={3}
          state={hasFunds && kycOk ? 'done' : onNetwork ? 'active' : 'todo'}
          title={t('live.step3')}
        >
          <p className="text-sm text-ink2 mb-3">{t('live.funds.b')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" disabled={claiming || hasFunds} onClick={claimFunds}>
              {claiming ? <Spinner /> : null} {hasFunds ? '✓' : ''} {t('live.funds.claim')}
            </button>
            <button className="btn" disabled={attesting || kycOk} onClick={issueKyc}>
              {attesting ? <Spinner /> : null} {kycOk ? `✓ ${t('live.funds.kycOk')}` : t('live.funds.kyc')}
            </button>
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
                  picked?.id === inv.id ? 'ring-2 ring-(--accent)' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-sm">{inv.fields!.invoiceNumber}</span>
                  <span className="badge badge-registered">#{inv.id}</span>
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
            <div className="flex items-center gap-2.5 text-sm text-ink2 mt-2">
              <Spinner className="text-accent" />
              {phase === 'preparing' && t('live.fund.preparing')}
              {phase === 'signing' && t('live.fund.signing')}
              {phase === 'broadcast' && t('live.fund.broadcast')}
              {phase === 'observing' && t('live.fund.observing')}
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
                <div className="text-good font-display text-xl font-bold">✓ {t('live.done.title')}</div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink3">paymentId</span>
                    <CopyText text={result.paymentId} display={shortHash(result.paymentId, 14)} />
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
    </div>
  );
}
