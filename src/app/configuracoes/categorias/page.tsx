"use client";

import { useState, useEffect } from 'react';
import { 
  Tag, 
  Plus, 
  ChevronRight, 
  ChevronDown, 
  Trash2, 
  Loader2, 
  TrendingUp, 
  TrendingDown,
  Layers,
  Pencil
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ConfigTabs } from '@/components/ConfigTabs';

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  type: 'revenue' | 'expense';
}

export default function CategoriasConfigPage() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [newCategory, setNewCategory] = useState({
    id: '' as string,
    name: '',
    type: 'expense' as 'revenue' | 'expense',
    parent_id: '' as string
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  async function fetchCategories() {
    setLoading(true);
    try {
      const res = await fetch('/api/system/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data || []);
      }
    } catch (err) {
      console.error('Erro ao buscar categorias:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleSave = async () => {
    if (!newCategory.name) return;
    setSaving(true);
    try {
      const isEditing = !!newCategory.id;
      const res = await fetch('/api/system/categories', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newCategory.id || undefined,
          name: newCategory.name,
          type: newCategory.type,
          parent_id: newCategory.parent_id || null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao salvar categoria');
      }
      
      setIsModalOpen(false);
      setNewCategory({ id: '', name: '', type: 'expense', parent_id: '' });
      fetchCategories();
    } catch (err: any) {
      alert('Erro ao salvar categoria: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza? Isso excluirá todas as subcategorias vinculadas.')) return;
    
    const res = await fetch(`/api/system/categories?id=${id}`, {
      method: 'DELETE'
    });
    
    if (res.ok) fetchCategories();
    else alert('Erro ao excluir categoria');
  };

  const renderCategoryTree = (type: 'revenue' | 'expense') => {
    const rootCategories = categories.filter(c => !c.parent_id && c.type === type);
    
    return (
      <div className="space-y-3">
        {rootCategories.map(parent => (
          <div key={parent.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <div className="p-4 flex items-center justify-between bg-slate-50/50 border-b border-slate-50">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${type === 'revenue' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  <Tag size={14} />
                </div>
                <span className="text-xs font-black uppercase tracking-widest text-slate-700">{parent.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    setNewCategory({ id: parent.id, name: parent.name, type: parent.type, parent_id: parent.parent_id || '' });
                    setIsModalOpen(true);
                  }}
                  className="p-1.5 text-slate-400 hover:text-blue-500 transition-colors"
                  title="Editar Categoria"
                >
                  <Pencil size={14} />
                </button>
                <button 
                  onClick={() => {
                    setNewCategory({ id: '', name: '', type, parent_id: parent.id });
                    setIsModalOpen(true);
                  }}
                  className="p-1.5 text-slate-400 hover:text-[#3b597b] transition-colors"
                  title="Adicionar Subcategoria"
                >
                  <Plus size={16} />
                </button>
                <button 
                  onClick={() => handleDelete(parent.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            
            <div className="divide-y divide-slate-50">
              {categories.filter(c => c.parent_id === parent.id).map(sub => (
                <div key={sub.id} className="p-3 pl-12 flex items-center justify-between group hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={12} className="text-slate-300" />
                    <span className="text-[11px] text-slate-500 uppercase tracking-tight font-medium">{sub.name}</span>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => {
                        setNewCategory({ id: sub.id, name: sub.name, type: sub.type, parent_id: sub.parent_id || '' });
                        setIsModalOpen(true);
                      }}
                      className="p-1 text-slate-300 hover:text-blue-500"
                    >
                      <Pencil size={12} />
                    </button>
                    <button 
                      onClick={() => handleDelete(sub.id)}
                      className="p-1 text-slate-300 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {categories.filter(c => c.parent_id === parent.id).length === 0 && (
                <div className="p-3 pl-12 text-[10px] text-slate-300 uppercase tracking-widest italic">
                  Nenhuma subcategoria
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1000px] space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <Layers className="text-[#3b597b]" size={24} />
          Mapa de Categorias (DRE)
        </h1>
        <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
          Organize o plano de contas da Holding para relatórios gerenciais.
        </p>
      </div>

      <ConfigTabs />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Receitas */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <TrendingUp size={18} /> Receitas
            </h2>
            <button 
              onClick={() => {
                setNewCategory({ id: '', name: '', type: 'revenue', parent_id: '' });
                setIsModalOpen(true);
              }}
              className="text-[10px] bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all"
            >+ Nova Raiz</button>
          </div>
          {loading ? <Loader2 className="animate-spin mx-auto text-slate-200" /> : renderCategoryTree('revenue')}
        </div>

        {/* Despesas */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-red-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <TrendingDown size={18} /> Despesas
            </h2>
            <button 
              onClick={() => {
                setNewCategory({ id: '', name: '', type: 'expense', parent_id: '' });
                setIsModalOpen(true);
              }}
              className="text-[10px] bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest hover:bg-red-100 transition-all"
            >+ Nova Raiz</button>
          </div>
          {loading ? <Loader2 className="animate-spin mx-auto text-slate-200" /> : renderCategoryTree('expense')}
        </div>

      </div>

      {/* Modal de Criação */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                {newCategory.id ? 'Editar Categoria' : 'Nova Categoria'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400">✕</button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Tipo de Fluxo</label>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                  <button 
                    onClick={() => setNewCategory({...newCategory, type: 'revenue'})}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${newCategory.type === 'revenue' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                  >Receita</button>
                  <button 
                    onClick={() => setNewCategory({...newCategory, type: 'expense'})}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${newCategory.type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}
                  >Despesa</button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Pertence a</label>
                <select 
                  value={newCategory.parent_id}
                  onChange={(e) => setNewCategory({...newCategory, parent_id: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[44px] text-xs focus:outline-none"
                >
                  <option value="">Nenhuma (Categoria Raiz)</option>
                  {categories.filter(c => !c.parent_id && c.type === newCategory.type).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Nome da Categoria</label>
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Ex: Aluguel, AWS, Consultoria..."
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 font-bold"
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/30 flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Cancelar</button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] bg-[#3b597b] text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/10 flex items-center justify-center gap-2 hover:bg-[#2e4763]"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Criar Categoria
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
