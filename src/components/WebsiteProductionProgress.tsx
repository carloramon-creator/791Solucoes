import { WEBSITE_PRODUCTION_STAGES, type WebsiteProductionStage } from '@/lib/website-production';

export function WebsiteProductionProgress({ stage }: { stage: WebsiteProductionStage }) {
  const entries = Object.entries(WEBSITE_PRODUCTION_STAGES).filter(([key]) => key !== 'completed');
  const index = stage === 'completed' ? entries.length : entries.findIndex(([key]) => key === stage);
  return <ol aria-label="Evolução do website" className="flex flex-wrap gap-2 text-xs">
    {entries.map(([key, label], position) => <li key={key} aria-current={key === stage ? 'step' : undefined}
      className={`rounded-full border px-3 py-1 ${position < index ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : position === index ? 'border-blue-200 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 text-slate-500'}`}>
      {label}{position < index ? ' · OK' : ''}
    </li>)}
  </ol>;
}
