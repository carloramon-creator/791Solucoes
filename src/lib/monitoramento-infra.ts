export type CpuAmostra = { cpu: string; inativo: number; total: number };
export type DiscoAmostra = { ponto: '/' | '/data'; total: number | null; disponivel: number | null };
export type DispositivoAmostra = { nome: string; leitura: number | null; gravacao: number | null };
export type InfraAmostra = {
  consultado_em: string;
  memoria_total: number | null;
  memoria_disponivel: number | null;
  cpu: CpuAmostra[];
  discos: DiscoAmostra[];
  dispositivos: DispositivoAmostra[];
};

const modosCpu = new Set(['idle', 'user', 'nice', 'system', 'iowait', 'irq', 'softirq', 'steal']);

export function interpretarMetricas(texto: string, projeto: string, consultadoEm: string): InfraAmostra {
  const cpus = new Map<string, Map<string, number>>();
  let total: number | null = null;
  let disponivel: number | null = null;
  const discos = new Map<string, { device: string; fstype: string; total: number | null; disponivel: number | null }>();
  const dispositivos = new Map<string, { leitura: number | null; gravacao: number | null }>();
  for (const linha of texto.split('\n')) {
    if (!/^(node_cpu_seconds_total|node_memory_MemTotal_bytes|node_memory_MemAvailable_bytes|node_filesystem_size_bytes|node_filesystem_avail_bytes|node_disk_read_bytes_total|node_disk_written_bytes_total)(?:\{|\s)/.test(linha)) continue;
    const amostra = linha.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(\S+)(?:\s+\d+)?\s*$/);
    if (!amostra) throw new Error('Formato de métricas inválido');
    const etiquetas = new Map<string, string>();
    const partes = amostra[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"(?:,|$)/g);
    for (const parte of partes) {
      if (etiquetas.has(parte[1])) throw new Error('Etiqueta duplicada');
      etiquetas.set(parte[1], JSON.parse(`"${parte[2]}"`));
    }
    if (etiquetas.get('supabase_identifier') !== projeto || etiquetas.get('service_type') !== 'db') continue;
    if (amostra[1].startsWith('node_filesystem_')) {
      const ponto = etiquetas.get('mountpoint');
      if ((ponto !== '/' && ponto !== '/data') || etiquetas.get('fstype') === 'rootfs'
        || etiquetas.get('device') === 'rootfs' || (etiquetas.get('device_error') ?? '') !== '') continue;
    }
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(amostra[3])) throw new Error('Valor de métrica inválido');
    const valor = Number(amostra[3]);
    if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor de métrica inválido');
    if (amostra[1] === 'node_memory_MemTotal_bytes') {
      if (total !== null) throw new Error('Métrica de memória duplicada');
      total = valor;
    } else if (amostra[1] === 'node_memory_MemAvailable_bytes') {
      if (disponivel !== null) throw new Error('Métrica de memória duplicada');
      disponivel = valor;
    } else if (amostra[1] === 'node_cpu_seconds_total') {
      const cpu = etiquetas.get('cpu');
      const modo = etiquetas.get('mode');
      if (!cpu || !modo || !modosCpu.has(modo)) continue;
      const tempos = cpus.get(cpu) ?? new Map<string, number>();
      if (tempos.has(modo)) throw new Error('Métrica de CPU duplicada');
      tempos.set(modo, valor);
      cpus.set(cpu, tempos);
    } else if (amostra[1] === 'node_filesystem_size_bytes' || amostra[1] === 'node_filesystem_avail_bytes') {
      const ponto = etiquetas.get('mountpoint');
      const device = etiquetas.get('device');
      const fstype = etiquetas.get('fstype');
      if (!ponto || !device || !fstype) throw new Error('Sistema de arquivos não identificado');
      const disco = discos.get(ponto) ?? { device, fstype, total: null, disponivel: null };
      if (disco.device !== device || disco.fstype !== fstype) throw new Error('Sistemas de arquivos ambíguos');
      const campo = amostra[1] === 'node_filesystem_size_bytes' ? 'total' : 'disponivel';
      if (disco[campo] !== null) throw new Error('Métrica de disco duplicada');
      disco[campo] = valor;
      discos.set(ponto, disco);
    } else {
      const nome = etiquetas.get('device');
      if (!nome) throw new Error('Dispositivo de disco não identificado');
      const dispositivo = dispositivos.get(nome) ?? { leitura: null, gravacao: null };
      const campo = amostra[1] === 'node_disk_read_bytes_total' ? 'leitura' : 'gravacao';
      if (dispositivo[campo] !== null) throw new Error('Métrica de dispositivo duplicada');
      dispositivo[campo] = valor;
      dispositivos.set(nome, dispositivo);
    }
  }
  const cpu = Array.from(cpus, ([nome, tempos]) => {
    const inativo = tempos.get('idle');
    if (inativo === undefined || tempos.size !== modosCpu.size) throw new Error('Métricas de CPU incompletas');
    return { cpu: nome, inativo, total: Array.from(tempos.values()).reduce((a, b) => a + b, 0) };
  }).sort((a, b) => a.cpu.localeCompare(b.cpu));
  if (total === null || disponivel === null) {
    total = null;
    disponivel = null;
  } else if (total <= 0 || disponivel > total) {
    throw new Error('Métricas de memória inválidas');
  }
  const pontos = (['/', '/data'] as const).map(ponto => {
    const disco = discos.get(ponto);
    if (!disco || disco.total === null || disco.disponivel === null) return { ponto, total: null, disponivel: null };
    if (disco.total <= 0 || disco.disponivel > disco.total) throw new Error('Métricas de disco inválidas');
    return { ponto, total: disco.total, disponivel: disco.disponivel };
  });
  if (total === null && cpu.length === 0 && pontos.every(d => d.total === null) && dispositivos.size === 0) {
    throw new Error('Métricas da instância principal indisponíveis');
  }
  return {
    consultado_em: consultadoEm, memoria_total: total, memoria_disponivel: disponivel, cpu, discos: pontos,
    dispositivos: Array.from(dispositivos, ([nome, valores]) => ({ nome, ...valores })).sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

export function validarInfra(value: unknown): value is InfraAmostra {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  const valido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return typeof a.consultado_em === 'string' && Number.isFinite(Date.parse(a.consultado_em))
    && ((a.memoria_total === null && a.memoria_disponivel === null)
      || (valido(a.memoria_total) && a.memoria_total > 0 && valido(a.memoria_disponivel) && a.memoria_disponivel <= a.memoria_total))
    && Array.isArray(a.cpu) && a.cpu.every((c: unknown) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
      const item = c as Record<string, unknown>;
      return typeof item.cpu === 'string' && item.cpu.length > 0 && valido(item.inativo)
        && valido(item.total) && item.inativo <= item.total;
    }) && new Set(a.cpu.map((c: CpuAmostra) => c.cpu)).size === a.cpu.length
    && Array.isArray(a.discos) && a.discos.length === 2
    && a.discos.every((d: unknown) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
      const disco = d as Record<string, unknown>;
      return (disco.ponto === '/' || disco.ponto === '/data')
        && ((disco.total === null && disco.disponivel === null)
          || (valido(disco.total) && disco.total > 0 && valido(disco.disponivel) && disco.disponivel <= disco.total));
    }) && new Set(a.discos.map((d: DiscoAmostra) => d.ponto)).size === 2
    && Array.isArray(a.dispositivos)
    && a.dispositivos.every((d: unknown) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
      const dispositivo = d as Record<string, unknown>;
      return typeof dispositivo.nome === 'string' && dispositivo.nome.length > 0
        && (dispositivo.leitura === null || valido(dispositivo.leitura))
        && (dispositivo.gravacao === null || valido(dispositivo.gravacao));
    }) && new Set(a.dispositivos.map((d: DispositivoAmostra) => d.nome)).size === a.dispositivos.length;
}

export function taxasDisco(anterior: InfraAmostra | null, atual: InfraAmostra): DispositivoAmostra[] {
  const intervalo = anterior ? (Date.parse(atual.consultado_em) - Date.parse(anterior.consultado_em)) / 1000 : 0;
  const utilizacaoCpu = percentualCpu(anterior, atual);
  const antigos = new Map(anterior?.dispositivos.map(d => [d.nome, d]) ?? []);
  return atual.dispositivos.map(d => {
    const antes = antigos.get(d.nome);
    const taxa = (novo: number | null, velho: number | null | undefined) =>
      intervalo >= 45 && intervalo <= 120 && utilizacaoCpu !== null
        && novo !== null && velho != null && novo >= velho ? (novo - velho) / intervalo : null;
    return { nome: d.nome, leitura: taxa(d.leitura, antes?.leitura), gravacao: taxa(d.gravacao, antes?.gravacao) };
  });
}

export type LeituraAlerta = { consultadoEm: string; cpu: number | null; memoria: number | null };

export function alertaSustentado(leituras: LeituraAlerta[], campo: 'cpu' | 'memoria'): boolean {
  if (leituras.length === 0) return false;
  let ultimaData: number | null = null;
  let fim: number | null = null;
  for (let i = leituras.length - 1; i >= 0; i--) {
    const leitura = leituras[i];
    const tempo = Date.parse(leitura.consultadoEm);
    const valor = leitura[campo];
    if (!Number.isFinite(tempo) || valor === null || !Number.isFinite(valor) || valor < 80
      || (ultimaData !== null && (tempo >= ultimaData || ultimaData - tempo > 90000))) break;
    if (fim === null) fim = tempo;
    if (fim - tempo >= 5 * 60 * 1000) return true;
    ultimaData = tempo;
  }
  return false;
}

export function percentualCpu(anterior: InfraAmostra | null, atual: InfraAmostra): number | null {
  if (!anterior || anterior.cpu.length === 0 || anterior.cpu.length !== atual.cpu.length) return null;
  const intervalo = Date.parse(atual.consultado_em) - Date.parse(anterior.consultado_em);
  if (!Number.isFinite(intervalo) || intervalo <= 0 || intervalo > 5 * 60 * 1000) return null;
  const anteriores = new Map(anterior.cpu.map(cpu => [cpu.cpu, cpu]));
  let total = 0;
  let inativo = 0;
  for (const cpu of atual.cpu) {
    const antes = anteriores.get(cpu.cpu);
    if (!antes || cpu.total < antes.total || cpu.inativo < antes.inativo) return null;
    const deltaTotal = cpu.total - antes.total;
    const deltaInativo = cpu.inativo - antes.inativo;
    if (deltaInativo > deltaTotal) return null;
    total += deltaTotal;
    inativo += deltaInativo;
  }
  return total > 0 ? (1 - inativo / total) * 100 : null;
}
