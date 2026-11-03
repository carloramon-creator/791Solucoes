/** Folga de 30 segundos para pequenas diferenças entre o relógio do servidor e o Sefin. */
export function dataHoraNacional(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 30_000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
