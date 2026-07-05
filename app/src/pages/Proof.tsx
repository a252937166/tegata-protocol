import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { ExtLink, CopyText, Spinner } from '../components/ui';
import { shortHash } from '../lib/format';

function ContractRows({ contracts, explorer }: { contracts: Record<string, string>; explorer: string }) {
  const { t } = useLang();
  return (
    <div className="space-y-3">
      {Object.entries(contracts).map(([name, addr]) => (
        <div key={name} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="w-40 flex-none font-semibold">{name}</span>
          <CopyText text={addr} display={addr} />
          <ExtLink href={`${explorer}/address/${addr}`}>explorer</ExtLink>
          <ExtLink href={`${explorer}/address/${addr}?tab=contract`}>{t('proof.verified')}</ExtLink>
        </div>
      ))}
    </div>
  );
}

export default function Proof() {
  const { t } = useLang();
  const { data: cfg, isLoading } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });
  const { data: showcase } = useQuery({ queryKey: ['showcase'], queryFn: api.showcase, staleTime: 60_000 });

  if (isLoading || !cfg)
    return (
      <div className="mx-auto max-w-4xl px-6 py-24 flex items-center gap-3 text-ink2">
        <Spinner /> {t('common.loading')}
      </div>
    );

  const sample = showcase?.packet;
  const legs = sample?.hspSettlement.legs ?? [];
  const funding = legs.find((l) => l.leg === 'funding');
  const repayment = legs.find((l) => l.leg === 'repayment');

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-14 fade-in">
      <div className="section-label">{t('nav.proof')}</div>
      <h1 className="font-display text-4xl font-bold mt-3">{t('proof.title')}</h1>
      <p className="text-ink2 mt-3">{t('proof.sub')}</p>

      {/* mainnet */}
      <div className="card p-6 mt-10">
        <div className="flex items-center gap-3 mb-4">
          <span className={`badge ${cfg.mainnet.deployed ? 'badge-repaid' : 'badge-funded'}`}>
            {cfg.mainnet.deployed ? 'LIVE' : 'IN PROGRESS'}
          </span>
          <span className="font-bold">{t('proof.mainnet')}</span>
        </div>
        {cfg.mainnet.deployed ? (
          <>
            <ContractRows contracts={cfg.mainnet.contracts} explorer={cfg.mainnet.explorer} />
            {cfg.mainnet.proof && (
              <>
                <div className="section-label mt-7 mb-3">{t('proof.mainnetProofTx')}</div>
                <dl className="space-y-2 text-xs">
                  {cfg.mainnet.proof.registerTxHash && (
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-ink3">{t('proof.registerTx')}</dt>
                      <dd>
                        <ExtLink href={`${cfg.mainnet.explorer}/tx/${cfg.mainnet.proof.registerTxHash}`} className="mono">
                          {shortHash(cfg.mainnet.proof.registerTxHash, 18)}
                        </ExtLink>
                      </dd>
                    </div>
                  )}
                  {cfg.mainnet.proof.packetAnchorTxHash && (
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-ink3">{t('proof.packetTx')}</dt>
                      <dd>
                        <ExtLink
                          href={`${cfg.mainnet.explorer}/tx/${cfg.mainnet.proof.packetAnchorTxHash}`}
                          className="mono"
                        >
                          {shortHash(cfg.mainnet.proof.packetAnchorTxHash, 18)}
                        </ExtLink>
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-ink2 leading-relaxed">{t('proof.mainnetPending')}</p>
        )}
      </div>

      {/* testnet */}
      <div className="card p-6 mt-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="badge badge-repaid">LIVE</span>
          <span className="font-bold">{t('proof.testnet')}</span>
        </div>
        <ContractRows contracts={cfg.contracts} explorer={cfg.chain.explorer} />

        <div className="section-label mt-8 mb-4">{t('proof.pinned')}</div>
        <dl className="space-y-2.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink3">{t('proof.adapter')}</dt>
            <dd>
              <CopyText text={cfg.hsp.pinnedAdapterAddress} display={cfg.hsp.pinnedAdapterAddress} />
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink3">{t('proof.issuer')}</dt>
            <dd>
              <CopyText text={cfg.hsp.pinnedIssuerAddress} display={cfg.hsp.pinnedIssuerAddress} />
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink3">{t('proof.stablecoin')}</dt>
            <dd>
              <ExtLink href={`${cfg.chain.explorer}/address/${cfg.stablecoin.address}`} className="mono">
                {cfg.stablecoin.address}
              </ExtLink>
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink3">{t('proof.coordinator')}</dt>
            <dd>
              <ExtLink href={cfg.hsp.coordinatorUrl}>{cfg.hsp.coordinatorUrl}</ExtLink>
            </dd>
          </div>
        </dl>
      </div>

      {/* sample packet evidence */}
      {sample && (
        <div className="card p-6 mt-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="badge badge-repaid">Tegata #{sample.invoice.registryId}</span>
            <span className="font-bold">{t('proof.sample')}</span>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <dt className="text-ink3">{t('proof.sample.invoiceHash')}</dt>
              <dd>
                <CopyText text={sample.invoice.invoiceHash} display={shortHash(sample.invoice.invoiceHash, 22)} />
              </dd>
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2">
              <dt className="text-ink3">{t('proof.sample.packetHash')}</dt>
              <dd>
                <CopyText
                  text={String(showcase?.invoice.packetHash ?? '')}
                  display={shortHash(String(showcase?.invoice.packetHash ?? ''), 22)}
                />
              </dd>
            </div>
            {funding && (
              <div className="flex flex-wrap justify-between items-center gap-2">
                <dt className="text-ink3">{t('proof.sample.fundingId')}</dt>
                <dd className="flex items-center gap-3">
                  <CopyText text={funding.paymentId} display={shortHash(funding.paymentId, 16)} />
                  <ExtLink href={funding.hspExplorerUrl}>{t('common.hspExplorer')}</ExtLink>
                  {funding.anchor.txHash && (
                    <ExtLink href={`${cfg.chain.explorer}/tx/${funding.anchor.txHash}`}>anchor</ExtLink>
                  )}
                </dd>
              </div>
            )}
            {repayment && (
              <div className="flex flex-wrap justify-between items-center gap-2">
                <dt className="text-ink3">{t('proof.sample.repaymentId')}</dt>
                <dd className="flex items-center gap-3">
                  <CopyText text={repayment.paymentId} display={shortHash(repayment.paymentId, 16)} />
                  <ExtLink href={repayment.hspExplorerUrl}>{t('common.hspExplorer')}</ExtLink>
                  {repayment.anchor.txHash && (
                    <ExtLink href={`${cfg.chain.explorer}/tx/${repayment.anchor.txHash}`}>anchor</ExtLink>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* kyc mode honesty card */}
      <div className="card p-6 mt-6">
        <div className="section-label mb-3">{t('proof.kycMode')}</div>
        <p className="text-sm text-ink2 leading-relaxed">{t('proof.kycMode.b')}</p>
      </div>
    </div>
  );
}
