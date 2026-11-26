'use client';

import { useEffect, useState, useCallback } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import {
  Users,
  Briefcase,
  Clock,
  Plus,
  Search,
  CheckCircle2,
  Calendar,
  Building,
  AlertCircle,
  FileText
} from 'lucide-react';

type Aba = 'funcionarios' | 'cargos' | 'ponto';

export default function RHPage() {
  const supabase = createSupabaseBrowser();
  const [abaAtiva, setAbaAtiva] = useState<Aba>('funcionarios');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);
  const [pontos, setPontos] = useState<any[]>([]);

  // Modais de Criação
  const [modalFuncionario, setModalFuncionario] = useState(false);
  const [modalCargo, setModalCargo] = useState(false);
  const [novoFuncionario, setNovoFuncionario] = useState({ nome: '', matricula: '', email: '', telefone: '', cargo_id: '' });
  const [novoCargo, setNovoCargo] = useState({ nome: '', setor: '', responsabilidades: '' });

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    setErro('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setCarregando(false); return; }

    try {
      const token = session.access_token;
      const headers = { Authorization: `Bearer ${token}` };

      const [resFunc, resCargos, resPonto] = await Promise.all([
        fetch('/api/admin/rh?tipo=funcionarios', { headers }),
        fetch('/api/admin/rh?tipo=cargos', { headers }),
        fetch('/api/admin/rh?tipo=ponto', { headers })
      ]);

      const jsonFunc = await resFunc.json();
      const jsonCargos = await resCargos.json();
      const jsonPonto = await resPonto.json();

      if (jsonFunc.funcionarios) setFuncionarios(jsonFunc.funcionarios);
      if (jsonCargos.cargos) setCargos(jsonCargos.cargos);
      if (jsonPonto.pontos) setPontos(jsonPonto.pontos);
    } catch {
      setErro('Erro ao carregar dados do RH.');
    } finally {
      setCarregando(false);
    }
  }, [supabase]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const salvarFuncionario = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch('/api/admin/rh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(novoFuncionario)
      });
      if (res.ok) {
        setModalFuncionario(false);
        setNovoFuncionario({ nome: '', matricula: '', email: '', telefone: '', cargo_id: '' });
        void carregarDados();
      } else {
        const j = await res.json();
        alert(j.error || 'Erro ao salvar funcionário');
      }
    } catch {
      alert('Falha na comunicação');
    }
  };

  const salvarCargo = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch('/api/admin/rh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ acao: 'criar_cargo', ...novoCargo })
      });
      if (res.ok) {
        setModalCargo(false);
        setNovoCargo({ nome: '', setor: '', responsabilidades: '' });
        void carregarDados();
      } else {
        const j = await res.json();
        alert(j.error || 'Erro ao salvar cargo');
      }
    } catch {
      alert('Falha na comunicação');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2.5">
            <Users className="h-7 w-7 text-[#3b597b]" />
            Recursos Humanos & Ponto Eletrônico
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestão da equipe, cargos, salários e espelho de ponto da 791 Soluções (Holding).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {abaAtiva === 'funcionarios' && (
            <button
              onClick={() => setModalFuncionario(true)}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f] flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Novo Colaborador
            </button>
          )}
          {abaAtiva === 'cargos' && (
            <button
              onClick={() => setModalCargo(true)}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f] flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Novo Cargo
            </button>
          )}
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setAbaAtiva('funcionarios')}
          className={`pb-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors ${
            abaAtiva === 'funcionarios'
              ? 'border-[#3b597b] text-[#3b597b]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="h-4 w-4" />
          Colaboradores ({funcionarios.length})
        </button>
        <button
          onClick={() => setAbaAtiva('cargos')}
          className={`pb-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors ${
            abaAtiva === 'cargos'
              ? 'border-[#3b597b] text-[#3b597b]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Cargos & Estrutura ({cargos.length})
        </button>
        <button
          onClick={() => setAbaAtiva('ponto')}
          className={`pb-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors ${
            abaAtiva === 'ponto'
              ? 'border-[#3b597b] text-[#3b597b]'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="h-4 w-4" />
          Espelho de Ponto Digital ({pontos.length})
        </button>
      </div>

      {/* Conteúdo das Abas */}
      {carregando ? (
        <div className="py-12 text-center text-sm text-slate-500 animate-pulse">Carregando módulo de RH...</div>
      ) : (
        <>
          {/* 1. ABA COLABORADORES */}
          {abaAtiva === 'funcionarios' && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {funcionarios.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Users className="h-6 w-6" />
                  </div>
                  <h3 className="font-bold text-slate-700 text-sm">Nenhum colaborador cadastrado</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Cadastre o primeiro colaborador da sua empresa para acompanhar cargos, jornadas e batidas de ponto.
                  </p>
                  <button
                    onClick={() => setModalFuncionario(true)}
                    className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f] inline-flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Cadastrar Agora
                  </button>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Nome / Matrícula</th>
                      <th className="p-3">Cargo / Setor</th>
                      <th className="p-3">Contato</th>
                      <th className="p-3">Admissão</th>
                      <th className="p-3 text-center">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {funcionarios.map(f => (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="p-3">
                          <p className="font-bold text-slate-800">{f.nome}</p>
                          <p className="text-[10px] text-slate-400 font-mono">Matrícula: {f.matricula}</p>
                        </td>
                        <td className="p-3">
                          <p className="font-semibold text-slate-700">{f.cargo?.nome || '—'}</p>
                          <p className="text-[10px] text-slate-400">{f.setor?.nome || 'Geral'}</p>
                        </td>
                        <td className="p-3">
                          <p className="text-slate-600">{f.email || '—'}</p>
                          <p className="text-[10px] text-slate-400">{f.telefone || '—'}</p>
                        </td>
                        <td className="p-3 text-slate-600">{f.admissao || '—'}</td>
                        <td className="p-3 text-center">
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            Ativo
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 2. ABA CARGOS */}
          {abaAtiva === 'cargos' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cargos.map(c => (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">{c.nome}</h3>
                      <p className="text-[11px] text-slate-400">{c.setor || 'Sem setor definido'}</p>
                    </div>
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  </div>
                  {c.responsabilidades && (
                    <p className="text-xs text-slate-600 line-clamp-3 bg-slate-50 p-2 rounded border border-slate-100">
                      {c.responsabilidades}
                    </p>
                  )}
                </div>
              ))}
              {cargos.length === 0 && (
                <div className="col-span-full py-8 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                  Nenhum cargo estruturado ainda.
                </div>
              )}
            </div>
          )}

          {/* 3. ABA PONTO DIGITAL */}
          {abaAtiva === 'ponto' && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {pontos.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  Nenhuma batida de ponto registrada até o momento.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Data / Hora</th>
                      <th className="p-3">Colaborador</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pontos.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700">
                          {new Date(p.marcada_em).toLocaleString('pt-BR')}
                        </td>
                        <td className="p-3 font-bold text-slate-800">{p.funcionario?.nome || '—'}</td>
                        <td className="p-3 uppercase font-bold text-indigo-700">{p.tipo}</td>
                        <td className="p-3 text-slate-500">{p.origem}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL NOVO COLABORADOR */}
      {modalFuncionario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">Cadastrar Novo Colaborador</h3>
            <form onSubmit={salvarFuncionario} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={novoFuncionario.nome}
                  onChange={e => setNovoFuncionario({ ...novoFuncionario, nome: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700">Matrícula</label>
                  <input
                    type="text"
                    required
                    value={novoFuncionario.matricula}
                    onChange={e => setNovoFuncionario({ ...novoFuncionario, matricula: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Cargo</label>
                  <select
                    value={novoFuncionario.cargo_id}
                    onChange={e => setNovoFuncionario({ ...novoFuncionario, cargo_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                  >
                    <option value="">Selecione...</option>
                    {cargos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Email Corporativo</label>
                <input
                  type="email"
                  value={novoFuncionario.email}
                  onChange={e => setNovoFuncionario({ ...novoFuncionario, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setModalFuncionario(false)}
                  className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#3b597b] px-4 py-1.5 font-bold text-white hover:bg-[#2d445f]"
                >
                  Salvar Colaborador
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NOVO CARGO */}
      {modalCargo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">Cadastrar Novo Cargo</h3>
            <form onSubmit={salvarCargo} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Título do Cargo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Desenvolvedor Senior, Vendedor, etc."
                  value={novoCargo.nome}
                  onChange={e => setNovoCargo({ ...novoCargo, nome: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Setor / Departamento</label>
                <input
                  type="text"
                  placeholder="Ex: Comercial, Tecnologia, Financeiro"
                  value={novoCargo.setor}
                  onChange={e => setNovoCargo({ ...novoCargo, setor: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Responsabilidades</label>
                <textarea
                  rows={3}
                  value={novoCargo.responsabilidades}
                  onChange={e => setNovoCargo({ ...novoCargo, responsabilidades: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setModalCargo(false)}
                  className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#3b597b] px-4 py-1.5 font-bold text-white hover:bg-[#2d445f]"
                >
                  Salvar Cargo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
