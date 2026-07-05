import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { ExtLink } from './ui';
import { shortAddr } from '../lib/format';

export default function Footer() {
  const { t } = useLang();
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 60_000 });
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-3 text-sm">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="hanko !w-8 !h-8 !text-base">手</span>
            <span className="font-display font-bold">TEGATA Protocol</span>
          </div>
          <p className="text-ink3 text-xs leading-relaxed">{t('foot.disclaimer')}</p>
        </div>
        <div className="text-xs space-y-1.5">
          <div className="section-label mb-2">Contracts · testnet</div>
          {cfg &&
            (Object.entries(cfg.contracts) as [string, string][]).map(([name, addr]) => (
              <div key={name} className="flex items-center gap-2 text-ink2">
                <span className="w-32 flex-none">{name}</span>
                <ExtLink href={`${cfg.chain.explorer}/address/${addr}`} className="mono">
                  {shortAddr(addr)}
                </ExtLink>
              </div>
            ))}
        </div>
        <div className="text-xs space-y-1.5">
          <div className="section-label mb-2">HSP</div>
          {cfg && (
            <>
              <div className="text-ink2">
                Coordinator: <ExtLink href={cfg.hsp.coordinatorUrl}>{cfg.hsp.coordinatorUrl.replace('https://', '')}</ExtLink>
              </div>
              <div className="text-ink2">
                SDK: <ExtLink href="https://github.com/project-hsp/hsp">github.com/project-hsp/hsp</ExtLink>
              </div>
            </>
          )}
          <p className="text-ink3 pt-2">{t('foot.built')}</p>
        </div>
      </div>
    </footer>
  );
}
