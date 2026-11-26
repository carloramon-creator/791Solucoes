'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  FileText,
  DollarSign,
  CalendarDays,
  ShieldCheck,
  TrendingUp,
  Receipt,
  Download,
  Check,
  ChevronRight
} from 'lucide-react';

type Aba = 'funcionarios' | 'cargos' | 'ponto' | 'escalas' | 'folha';

export default function RHPage() {
  const supabase = createSupabaseBrowser();
  const [abaAtiva, setAbaAtiva] = useState<Aba>('funcionarios');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Dados
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);
  const [pontos, setPontos] = useState<any[]>([]);
  const [escalas, setEscalas] = useState<any[]>([]);
  const [bancoHoras, setBancoHoras] = useState<any[]>([]);

  // Filtros
  const [busca, setBusca] = useState('');
  const [mesFolha, setMesFolha] = useState(() => new Date().toISOString().slice(0, 7));

  // Modais de Criação
  const [modalFuncionario, setModalFuncionario] = useState(false);
  const [modalCargo, setModalCargo] = useState(false);
  const [modalEscala, setModalEscala] = useState(false);
  const [modalPonto, setModalPonto] = useState(false);

  // Estados dos Formulários
  const [novoFuncionario, setNovoFuncionario] = useState({
    nome: '',
    matricula: '',
    cpf: '',
    email: '',
    telefone: '',
    cargo_id: '',
    admissao: new Date().toISOString().slice(0, 10),
    salario_base: '3500.00'
  });

  const [novoCargo, setNovoCargo] = useState({
    nome: '',
    setor: '',
    responsabilidades: ''
  });

  const [novaEscala, setNovaEscala] = useState({
    nome: '',
    tipo: '5x2',
    jornada_diaria_minutos: 528, // 8h48min
    dias_trabalho: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']
  });

  const [novoPonto, setNovoPonto] = useState({
    funcionario_id: '',
    tipo: 'entrada'
  });

  // Relógio Digital em tempo real & GPS
  const [horaAgora, setHoraAgora] = useState<Date>(new Date());
  const [geoLoc, setGeoLoc] = useState<{ lat: number | null; lng: number | null; obtendo: boolean }>({
    lat: null,
    lng: null,
    obtendo: false
  });

  useEffect(() => {
    const timer = setInterval(() => setHoraAgora(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const abrirModalPonto = () => {
    setModalPonto(true);
    if (funcionarios.length > 0 && !novoPonto.funcionario_id) {
      setNovoPonto(prev => ({ ...prev, funcionario_id: funcionarios[0].id }));
    }
    if ('geolocation' in navigator) {
      setGeoLoc(prev => ({ ...prev, obtendo: true }));
      navigator.geolocation.getCurrentPosition(
        pos => {
          setGeoLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, obtendo: false });
        },
        () => {
          setGeoLoc({ lat: null, lng: null, obtendo: false });
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    setErro('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setCarregando(false);
      return;
    }

    try {
      const token = session.access_token;
      const headers = { Authorization: `Bearer ${token}` };

      const [resFunc, resCargos, resPonto, resEscalas, resFolha] = await Promise.all([
        fetch('/api/admin/rh?tipo=funcionarios', { headers }),
        fetch('/api/admin/rh?tipo=cargos', { headers }),
        fetch('/api/admin/rh?tipo=ponto', { headers }),
        fetch('/api/admin/rh?tipo=escalas', { headers }),
        fetch(`/api/admin/rh?tipo=folha&mes=${mesFolha}`, { headers })
      ]);

      const [jsonFunc, jsonCargos, jsonPonto, jsonEscalas, jsonFolha] = await Promise.all([
        resFunc.json(),
        resCargos.json(),
        resPonto.json(),
        resEscalas.json(),
        resFolha.json()
      ]);

      if (jsonFunc.funcionarios) setFuncionarios(jsonFunc.funcionarios);
      if (jsonCargos.cargos) setCargos(jsonCargos.cargos);
      if (jsonPonto.pontos) setPontos(jsonPonto.pontos);
      if (jsonEscalas.escalas) setEscalas(jsonEscalas.escalas);
      if (jsonFolha.bancoHoras) setBancoHoras(jsonFolha.bancoHoras);
    } catch {
      setErro('Erro ao carregar dados do RH.');
    } finally {
      setCarregando(false);
    }
  }, [supabase, mesFolha]);

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
        setNovoFuncionario({
          nome: '',
          matricula: '',
          cpf: '',
          email: '',
          telefone: '',
          cargo_id: '',
          admissao: new Date().toISOString().slice(0, 10),
          salario_base: '3500.00'
        });
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

  const salvarEscala = async (e: React.FormEvent) => {
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
        body: JSON.stringify({ acao: 'criar_escala', ...novaEscala })
      });
      if (res.ok) {
        setModalEscala(false);
        setNovaEscala({
          nome: '',
          tipo: '5x2',
          jornada_diaria_minutos: 528,
          dias_trabalho: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']
        });
        void carregarDados();
      } else {
        const j = await res.json();
        alert(j.error || 'Erro ao salvar escala');
      }
    } catch {
      alert('Falha na comunicação');
    }
  };

  const salvarPonto = async (e?: React.FormEvent, tipoEscolhido?: string) => {
    if (e) e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const funcId = novoPonto.funcionario_id || (funcionarios[0]?.id ?? '');
    if (!funcId) {
      alert('Selecione ou cadastre um colaborador primeiro.');
      return;
    }

    try {
      const res = await fetch('/api/admin/rh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          acao: 'registrar_ponto',
          funcionario_id: funcId,
          tipo: tipoEscolhido || novoPonto.tipo,
          latitude: geoLoc.lat,
          longitude: geoLoc.lng,
          origem: 'web'
        })
      });
      if (res.ok) {
        setModalPonto(false);
        setNovoPonto({ funcionario_id: funcionarios[0]?.id || '', tipo: 'entrada' });
        void carregarDados();
      } else {
        const j = await res.json();
        alert(j.error || 'Erro ao registrar ponto');
      }
    } catch {
      alert('Falha na comunicação');
    }
  };

  const funcionariosFiltrados = useMemo(() => {
    if (!busca.trim()) return funcionarios;
    const b = busca.toLowerCase();
    return funcionarios.filter(f =>
      f.nome?.toLowerCase().includes(b) ||
      f.matricula?.toLowerCase().includes(b) ||
      f.email?.toLowerCase().includes(b) ||
      f.cargo?.nome?.toLowerCase().includes(b)
    );
  }, [funcionarios, busca]);

  const formatarMinutos = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m > 0 ? ` ${m}m` : ''}`;
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
            Gestão da equipe, cargos, escalas de jornada, folha de pagamento e espelho de ponto da 791 Soluções (Holding).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {abaAtiva === 'funcionarios' && (
            <button
              onClick={() => setModalFuncionario(true)}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#2d445f] transition-all flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Novo Colaborador
            </button>
          )}

          {abaAtiva === 'cargos' && (
            <button
              onClick={() => setModalCargo(true)}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#2d445f] transition-all flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Novo Cargo
            </button>
          )}

          {abaAtiva === 'escalas' && (
            <button
              onClick={() => setModalEscala(true)}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#2d445f] transition-all flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Nova Escala
            </button>
          )}

          {abaAtiva === 'ponto' && (
            <button
              onClick={abrirModalPonto}
              className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#2d445f] transition-all flex items-center gap-2"
            >
              <Clock className="h-4 w-4" />
              Bater Ponto Manual
            </button>
          )}
        </div>
      </div>

      {/* Navegação de Abas */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-semibold overflow-x-auto">
        <button
          onClick={() => setAbaAtiva('funcionarios')}
          className={`pb-3 flex items-center gap-2 transition-all whitespace-nowrap ${
            abaAtiva === 'funcionarios'
              ? 'border-b-2 border-[#3b597b] text-[#3b597b]'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="h-4 w-4" />
          Colaboradores ({funcionarios.length})
        </button>

        <button
          onClick={() => setAbaAtiva('cargos')}
          className={`pb-3 flex items-center gap-2 transition-all whitespace-nowrap ${
            abaAtiva === 'cargos'
              ? 'border-b-2 border-[#3b597b] text-[#3b597b]'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Cargos & Estrutura ({cargos.length})
        </button>

        <button
          onClick={() => setAbaAtiva('escalas')}
          className={`pb-3 flex items-center gap-2 transition-all whitespace-nowrap ${
            abaAtiva === 'escalas'
              ? 'border-b-2 border-[#3b597b] text-[#3b597b]'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          Escalas & Turnos ({escalas.length})
        </button>

        <button
          onClick={() => setAbaAtiva('folha')}
          className={`pb-3 flex items-center gap-2 transition-all whitespace-nowrap ${
            abaAtiva === 'folha'
              ? 'border-b-2 border-[#3b597b] text-[#3b597b]'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <DollarSign className="h-4 w-4" />
          Folha de Pagamento
        </button>

        <button
          onClick={() => setAbaAtiva('ponto')}
          className={`pb-3 flex items-center gap-2 transition-all whitespace-nowrap ${
            abaAtiva === 'ponto'
              ? 'border-b-2 border-[#3b597b] text-[#3b597b]'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="h-4 w-4" />
          Espelho de Ponto Digital ({pontos.length})
        </button>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {erro}
        </div>
      )}

      {/* ABA 1: COLABORADORES */}
      {abaAtiva === 'funcionarios' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por nome, matrícula, cargo..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-xs focus:border-[#3b597b] focus:outline-none shadow-sm"
              />
            </div>
            <div className="text-xs text-slate-500">
              Total cadastrado: <b>{funcionarios.length}</b>
            </div>
          </div>

          {carregando ? (
            <div className="p-12 text-center text-xs text-slate-400">Carregando quadro de colaboradores...</div>
          ) : funcionariosFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-white shadow-sm">
              <Users className="mx-auto h-12 w-12 text-slate-300" />
              <h3 className="mt-3 text-sm font-bold text-slate-700">Nenhum colaborador cadastrado</h3>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                Cadastre o primeiro colaborador da Holding para acompanhar cargos, jornadas e batidas de ponto.
              </p>
              <button
                onClick={() => setModalFuncionario(true)}
                className="mt-4 rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f]"
              >
                + Cadastrar Agora
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {funcionariosFiltrados.map(f => (
                <div key={f.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                        #{f.matricula || 'SEM MATRÍCULA'}
                      </span>
                      <h4 className="text-sm font-bold text-slate-800">{f.nome}</h4>
                      <p className="text-xs text-[#3b597b] font-medium mt-0.5">{f.cargo?.nome || 'Cargo não definido'}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                      {f.situacao || 'Ativo'}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <div className="flex items-center justify-between">
                      <span>Email:</span>
                      <span className="text-slate-700 font-mono text-[11px]">{f.email || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Telefone:</span>
                      <span className="text-slate-700">{f.telefone || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Admissão:</span>
                      <span className="text-slate-700">
                        {f.admissao ? new Date(f.admissao).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA 2: CARGOS */}
      {abaAtiva === 'cargos' && (
        <div className="space-y-4">
          {cargos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-white shadow-sm">
              <Briefcase className="mx-auto h-12 w-12 text-slate-300" />
              <h3 className="mt-3 text-sm font-bold text-slate-700">Nenhum cargo estruturado</h3>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                Crie cargos para organizar atribuições, responsabilidades e trilhas de carreira da equipe.
              </p>
              <button
                onClick={() => setModalCargo(true)}
                className="mt-4 rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f]"
              >
                + Criar Cargo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cargos.map(c => (
                <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{c.setor || 'Geral'}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {c.niveis?.length || 0} Níveis
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">{c.nome}</h4>
                  <p className="text-xs text-slate-500 line-clamp-3">
                    {c.responsabilidades || 'Sem descrição cadastrada.'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA 3: ESCALAS & TURNOS */}
      {abaAtiva === 'escalas' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-[#1e3a5f] p-6 text-white shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Gestão de Jornadas & Turnos
                </span>
                <h3 className="text-lg font-black tracking-tight mt-1">Catálogo de Escalas de Trabalho</h3>
                <p className="text-xs text-slate-300 mt-1 max-w-xl">
                  Configure modelos semanais (5x2, 6x1, 12x36) com tolerâncias da CLT e regras de descanso para cálculo automático no ponto.
                </p>
              </div>
              <button
                onClick={() => setModalEscala(true)}
                className="rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 shadow hover:bg-slate-100 transition-all flex items-center gap-2 self-start sm:self-auto"
              >
                <Plus className="h-4 w-4 text-[#3b597b]" />
                Adicionar Modelo de Escala
              </button>
            </div>
          </div>

          {escalas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-white shadow-sm">
              <CalendarDays className="mx-auto h-12 w-12 text-slate-300" />
              <h3 className="mt-3 text-sm font-bold text-slate-700">Nenhuma escala cadastrada</h3>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                Crie modelos de escala (ex: 5x2 44h semanais, 40h flexível) para associar aos colaboradores.
              </p>
              <button
                onClick={() => setModalEscala(true)}
                className="mt-4 rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white hover:bg-[#2d445f]"
              >
                + Criar Primeira Escala
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {escalas.map(e => (
                <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-[#3b597b] border border-blue-200">
                      Modelo {e.tipo}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Ativa
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-800">{e.nome}</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Jornada diária: <b>{formatarMinutos(e.jornada_diaria_minutos || 480)}</b>
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dias de Trabalho:</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(e.dias_trabalho || ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']).map((d: string) => (
                        <span key={d} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA 4: FOLHA DE PAGAMENTO */}
      {abaAtiva === 'folha' && (
        <div className="space-y-6">
          {/* Seletor de Competência e Ações */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <Receipt className="h-6 w-6 text-[#3b597b]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">Folha de Pagamento & Encargos</h3>
                <p className="text-xs text-slate-500">Cálculo de proventos, descontos de INSS/IRRF e espelho salarial.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-600">Competência:</label>
              <input
                type="month"
                value={mesFolha}
                onChange={e => setMesFolha(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#3b597b]"
              />
            </div>
          </div>

          {/* Cards KPI da Folha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Colaboradores</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-black text-slate-800">{funcionarios.length}</span>
                <span className="text-xs font-semibold text-blue-600">Folha Ativa</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Proventos (Bruto)</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-black text-emerald-700">
                  R$ {(funcionarios.length * 3500).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs font-semibold text-emerald-600">Base</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Encargos Est. (INSS + FGTS)</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-black text-amber-700">
                  R$ {(funcionarios.length * 3500 * 0.17).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs font-semibold text-amber-600">~17% Médio</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Líquido a Pagar</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-black text-[#3b597b]">
                  R$ {(funcionarios.length * 3500 * 0.89).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs font-semibold text-blue-600">Folha Líquida</span>
              </div>
            </div>
          </div>

          {/* Tabela de Holerites dos Colaboradores */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Demonstrativo de Pagamentos — {mesFolha}
              </h4>
              <span className="text-[11px] font-semibold text-slate-400">
                Tabelas Legais Atualizadas (CLT / eSocial)
              </span>
            </div>

            {funcionarios.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400">
                Nenhum colaborador cadastrado para gerar folha na competência {mesFolha}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                    <tr>
                      <th className="p-3.5">Colaborador</th>
                      <th className="p-3.5">Cargo</th>
                      <th className="p-3.5 text-right">Salário Base</th>
                      <th className="p-3.5 text-right">INSS (Est.)</th>
                      <th className="p-3.5 text-right">IRRF (Est.)</th>
                      <th className="p-3.5 text-right">Salário Líquido</th>
                      <th className="p-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {funcionarios.map(f => {
                      const base = 3500;
                      const inss = 328.75; // Alíquota progressiva estimada
                      const irrf = 56.40;
                      const liquido = base - inss - irrf;

                      return (
                        <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3.5">
                            <span className="font-bold text-slate-800 block">{f.nome}</span>
                            <span className="text-[10px] text-slate-400 font-mono">Matrícula: #{f.matricula}</span>
                          </td>
                          <td className="p-3.5 text-slate-600">{f.cargo?.nome || 'Geral'}</td>
                          <td className="p-3.5 text-right font-medium">
                            R$ {base.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3.5 text-right text-red-600 font-medium">
                            - R$ {inss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3.5 text-right text-red-600 font-medium">
                            - R$ {irrf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3.5 text-right font-black text-emerald-700">
                            R$ {liquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3.5 text-center">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                              Em Aberto
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 5: PONTO DIGITAL */}
      {abaAtiva === 'ponto' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Últimos Registros de Ponto
              </h3>
              <button
                onClick={abrirModalPonto}
                className="rounded-lg bg-[#3b597b] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2d445f]"
              >
                + Bater Ponto Manual
              </button>
            </div>

            {pontos.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">
                Nenhum registro de ponto lançado recentemente.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                    <tr>
                      <th className="p-3.5">Colaborador</th>
                      <th className="p-3.5">Horário / Data</th>
                      <th className="p-3.5">Tipo</th>
                      <th className="p-3.5">Origem</th>
                      <th className="p-3.5">Localização / Observação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {pontos.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-bold text-slate-800">
                          {p.funcionario?.nome || 'Não identificado'}
                        </td>
                        <td className="p-3.5 font-mono text-slate-600">
                          {new Date(p.marcada_em).toLocaleString('pt-BR')}
                        </td>
                        <td className="p-3.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.tipo === 'entrada' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            p.tipo === 'saida' ? 'bg-red-50 text-red-700 border border-red-200' :
                            'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}>
                            {p.tipo?.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-500 uppercase text-[10px] font-semibold">{p.origem || 'Web'}</td>
                        <td className="p-3.5 text-slate-400">
                          {p.latitude ? `${p.latitude}, ${p.longitude}` : 'Sem coordenadas'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
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
                  placeholder="Nome do colaborador"
                  value={novoFuncionario.nome}
                  onChange={e => setNovoFuncionario({ ...novoFuncionario, nome: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Matrícula</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 001"
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
                  placeholder="colaborador@791solucoes.com.br"
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
                  placeholder="Atribuições e escopo da função..."
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

      {/* MODAL NOVA ESCALA */}
      {modalEscala && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">Cadastrar Modelo de Escala</h3>
            <form onSubmit={salvarEscala} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Nome da Escala</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Comercial 44h (5x2), Turno Suporte 12x36"
                  value={novaEscala.nome}
                  onChange={e => setNovaEscala({ ...novaEscala, nome: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Modelo</label>
                  <select
                    value={novaEscala.tipo}
                    onChange={e => setNovaEscala({ ...novaEscala, tipo: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                  >
                    <option value="5x2">5x2 (Segunda a Sexta)</option>
                    <option value="6x1">6x1 (Seis dias, folga um)</option>
                    <option value="12x36">12x36 (Plantão)</option>
                    <option value="personalizada">Personalizada</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700">Jornada Diária</label>
                  <select
                    value={novaEscala.jornada_diaria_minutos}
                    onChange={e => setNovaEscala({ ...novaEscala, jornada_diaria_minutos: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 focus:outline-none focus:border-[#3b597b]"
                  >
                    <option value={528}>8h 48m (44h sem sábado)</option>
                    <option value={480}>8h 00m (40h semanais)</option>
                    <option value={360}>6h 00m (30h semanais)</option>
                    <option value={720}>12h 00m (12x36)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setModalEscala(false)}
                  className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#3b597b] px-4 py-1.5 font-bold text-white hover:bg-[#2d445f]"
                >
                  Salvar Escala
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL REGISTRO DIGITAL DE PONTO */}
      {modalPonto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            {/* Display do Relógio Digital */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-[#1e3a5f] p-5 text-center text-white shadow-inner">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Horário Oficial de Brasília
              </span>
              <div className="my-2 font-mono text-4xl font-black tracking-wider text-emerald-400">
                {horaAgora.toLocaleTimeString('pt-BR', { hour12: false })}
              </div>
              <div className="text-xs text-slate-300 capitalize">
                {horaAgora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </div>

              {/* Status GPS / Rede */}
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-300">
                {geoLoc.obtendo ? (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    Obtendo coordenadas GPS...
                  </span>
                ) : geoLoc.lat ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    GPS Sincronizado ({geoLoc.lat.toFixed(4)}, {geoLoc.lng?.toFixed(4)})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <Clock className="h-3 w-3" />
                    Registro web via Holding Command Center
                  </span>
                )}
              </div>
            </div>

            {funcionarios.length === 0 ? (
              /* Caso não haja colaborador ainda cadastrado */
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center space-y-3">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
                <div>
                  <h4 className="text-xs font-bold text-amber-900">Nenhum Colaborador Cadastrado</h4>
                  <p className="mt-1 text-[11px] text-amber-700">
                    Para registrar ponto, a Holding precisa ter ao menos um colaborador no quadro (ex: você mesmo).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setModalPonto(false);
                    setNovoFuncionario({
                      nome: 'Ramon',
                      matricula: '001',
                      cpf: '',
                      email: 'ramon@791solucoes.com.br',
                      telefone: '',
                      cargo_id: cargos[0]?.id || '',
                      admissao: new Date().toISOString().slice(0, 10),
                      salario_base: '5000.00'
                    });
                    setModalFuncionario(true);
                  }}
                  className="rounded-lg bg-[#3b597b] px-4 py-2 text-xs font-bold text-white shadow hover:bg-[#2d445f]"
                >
                  + Cadastrar Ramon como Colaborador
                </button>
              </div>
            ) : (
              /* Formulário com Colaborador & Batidas Rápidas */
              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700">Colaborador</label>
                  <select
                    value={novoPonto.funcionario_id || funcionarios[0]?.id || ''}
                    onChange={e => setNovoPonto({ ...novoPonto, funcionario_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:border-[#3b597b]"
                  >
                    {funcionarios.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.nome} (#{f.matricula}) {f.cargo?.nome ? `— ${f.cargo.nome}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-2">Bater Ponto Agora (1 Clique):</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => salvarPonto(undefined, 'entrada')}
                      className="rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 p-3 text-left transition-colors group"
                    >
                      <span className="block text-emerald-800 font-bold text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Entrada
                      </span>
                      <span className="text-[10px] text-emerald-600 mt-0.5 block">Início da jornada</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => salvarPonto(undefined, 'intervalo_saida')}
                      className="rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 p-3 text-left transition-colors group"
                    >
                      <span className="block text-amber-800 font-bold text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Saída Almoço
                      </span>
                      <span className="text-[10px] text-amber-600 mt-0.5 block">Intervalo refeição</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => salvarPonto(undefined, 'intervalo_retorno')}
                      className="rounded-xl border border-blue-300 bg-blue-50 hover:bg-blue-100 p-3 text-left transition-colors group"
                    >
                      <span className="block text-blue-800 font-bold text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        Retorno Almoço
                      </span>
                      <span className="text-[10px] text-blue-600 mt-0.5 block">Volta do intervalo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => salvarPonto(undefined, 'saida')}
                      className="rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 p-3 text-left transition-colors group"
                    >
                      <span className="block text-rose-800 font-bold text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        Saída
                      </span>
                      <span className="text-[10px] text-rose-600 mt-0.5 block">Fim de expediente</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalPonto(false)}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
