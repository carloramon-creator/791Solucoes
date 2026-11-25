import { readFinanceConfig } from '@/lib/finance-config-server';
import { interpretarMetricas, type InfraAmostra } from '@/lib/monitoramento-infra';

export async function consultarInfraGlass(): Promise<InfraAmostra> {
  const config = await readFinanceConfig();
  if (typeof config.glassUrl !== 'string' || typeof config.glassServiceKey !== 'string' || !config.glassServiceKey) {
    throw new Error('Configuração de métricas do Glass indisponível');
  }
  const url = new URL(config.glassUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
    throw new Error('URL do Glass inválida para métricas');
  }
  const projeto = url.hostname.split('.')[0];
  const resposta = await fetch(`${url.origin}/customer/v1/privileged/metrics`, {
    headers: { Authorization: `Basic ${Buffer.from(`service_role:${config.glassServiceKey}`).toString('base64')}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!resposta.ok) throw new Error(`Consulta de métricas falhou: ${resposta.status}`);
  const texto = await resposta.text();
  return interpretarMetricas(texto, projeto, new Date().toISOString());
}
