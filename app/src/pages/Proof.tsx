import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { ExtLink, CopyText, Spinner } from '../components/ui';

export default function Proof() {
  const { t } = useLang();
  const { data: cfg, isLoading } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });

  if (isLoading || !cfg)
    return (
      <div className="mx-auto max-w-4xl px-6 py-24 flex items-center gap-3 text-ink2">
        <Spinner /> {t('common.loading')}
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-14 fade-in">
      <div className="section-label">{t('nav.proof')}</div>
      <h1 className="font-display text-4xl font-bold mt-3">{t('proof.title')}</h1>
      <p className="text-ink2 mt-3">{t('proof.sub')}</p>

      {/* testnet */}
      <div className="card p-6 mt-10">
        <div className="flex items-center gap-3 mb-5">
          <span className="badge badge-repaid">LIVE</span>
          <span className="font-bold">{t('proof.testnet')}</span>
        </div>
        <div className="space-y-3">
          {(Object.entries(cfg.contracts) as [string, string][]).map(([name, addr]) => (
            <div key={name} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="w-40 flex-none font-semibold">{name}</span>
              <CopyText text={addr} display={addr} />
              <ExtLink href={`${cfg.chain.explorer}/address/${addr}?tab=contract`}>{t('proof.verified')}</ExtLink>
            </div>
          ))}
        </div>

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

      {/* mainnet */}
      <div className="card p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="badge badge-funded">{cfg.mainnet.deployed ? 'LIVE' : 'PENDING'}</span>
          <span className="font-bold">{t('proof.mainnet')}</span>
        </div>
        <p className="text-sm text-ink2 leading-relaxed">{t('proof.mainnetPending')}</p>
      </div>
    </div>
  );
}
