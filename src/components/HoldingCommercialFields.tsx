"use client";

import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export const commercialFieldClass = 'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:border-[#3b597b] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 disabled:bg-slate-50';
export const commercialInputClass = `${commercialFieldClass} h-11`;
export const commercialLabelClass = 'flex flex-col gap-1.5 text-sm font-semibold text-slate-700';
export const commercialButtonClass = 'inline-flex items-center justify-center gap-2 rounded-md bg-[#3b597b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e4763] disabled:opacity-50';
export const commercialSecondaryClass = 'inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const commercialMoney = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export function HoldingCommercialSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${commercialInputClass} appearance-none pr-10`} />
      <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
    </span>
  );
}
