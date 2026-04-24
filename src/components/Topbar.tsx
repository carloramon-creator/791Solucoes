"use client";

import { Bell, Maximize, Moon, Search, Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';

export function Topbar() {
  const pathname = usePathname();
  
  if (pathname === '/login') return null;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center text-sm text-slate-500">
        <button className="mr-4 text-slate-400 hover:text-slate-600">
          <Search size={20} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center bg-[#6899c4] text-white text-xs font-medium px-4 py-2 rounded shadow-sm mr-2 cursor-pointer hover:bg-[#5a86ae] transition-colors">
          <span className="tracking-wide">VISÃO GLOBAL - 791</span>
          <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>

        <button className="p-2 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-50 transition-colors">
          <Settings size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-50 transition-colors">
          <Moon size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-50 transition-colors">
          <Maximize size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-50 transition-colors relative">
          <Bell size={18} />
          <span className="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-white" />
        </button>
        
        <div className="ml-2 h-8 w-8 rounded-full bg-slate-200 overflow-hidden border border-slate-200 cursor-pointer hover:opacity-80 transition-opacity">
          <img src="https://i.pravatar.cc/150?u=admin791" alt="Profile" className="h-full w-full object-cover" />
        </div>
      </div>
    </header>
  );
}
