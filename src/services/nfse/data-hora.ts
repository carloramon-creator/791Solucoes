/** Horário de Brasília para a holding em 2026, com folga de 30 segundos em relação ao Sefin. */
export function dataHoraNacional(agora: Date = new Date()): string {
  const fusoBrasiliaMs = -3 * 60 * 60 * 1000;
  return new Date(agora.getTime() - 30_000 + fusoBrasiliaMs)
    .toISOString().replace(/\.\d{3}Z$/, '-03:00');
}
