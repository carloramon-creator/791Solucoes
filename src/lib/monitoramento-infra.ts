export type CpuAmostra = { cpu: string; inativo: number; total: number };
export type InfraAmostra = {
  consultado_em: string;
  memoria_total: number | null;
  memoria_disponivel: number | null;
  cpu: CpuAmostra[];
};

const modosCpu = new Set(['idle', 'user', 'nice', 'system', 'iowait', 'irq', 'softirq', 'steal']);

export function interpretarMetricas(texto: string, projeto: string, consultadoEm: string): InfraAmostra {
  const cpus = new Map<string, Map<string, number>>();
  let total: number | null = null;
  let disponivel: number | null = null;
  for (const linha of texto.split('\n')) {
    if (!/^(node_cpu_seconds_total|node_memory_MemTotal_bytes|node_memory_MemAvailable_bytes)(?:\{|\s)/.test(linha)) continue;
    const amostra = linha.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(\S+)(?:\s+\d+)?\s*$/);
    if (!amostra) throw new Error('Formato de métricas inválido');
    const etiquetas = new Map<string, string>();
    const partes = amostra[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"(?:,|$)/g);
    for (const parte of partes) {
      if (etiquetas.has(parte[1])) throw new Error('Etiqueta duplicada');
      etiquetas.set(parte[1], JSON.parse(`"${parte[2]}"`));
    }
    if (etiquetas.get('supabase_identifier') !== projeto || etiquetas.get('service_type') !== 'db') continue;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(amostra[3])) throw new Error('Valor de métrica inválido');
    const valor = Number(amostra[3]);
    if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor de métrica inválido');
    if (amostra[1] === 'node_memory_MemTotal_bytes') {
      if (total !== null) throw new Error('Métrica de memória duplicada');
      total = valor;
    } else if (amostra[1] === 'node_memory_MemAvailable_bytes') {
      if (disponivel !== null) throw new Error('Métrica de memória duplicada');
      disponivel = valor;
    } else {
      const cpu = etiquetas.get('cpu');
      const modo = etiquetas.get('mode');
      if (!cpu || !modo || !modosCpu.has(modo)) continue;
      const tempos = cpus.get(cpu) ?? new Map<string, number>();
      if (tempos.has(modo)) throw new Error('Métrica de CPU duplicada');
      tempos.set(modo, valor);
      cpus.set(cpu, tempos);
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
  if (total === null && cpu.length === 0) throw new Error('Métricas da instância principal indisponíveis');
  return { consultado_em: consultadoEm, memoria_total: total, memoria_disponivel: disponivel, cpu };
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
    }) && new Set(a.cpu.map((c: CpuAmostra) => c.cpu)).size === a.cpu.length;
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
