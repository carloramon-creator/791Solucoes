/**
 * Mapeamento de códigos municipais TOM para provedores de NFS-e
 * Baseado na documentação SIAPE/TOM
 */

export const MUNICIPAL_CODE_TO_PROVIDER: Record<string, 'national' | 'ipm'> = {
    // São José/SC - IPM Fiscal (Atende.Net)
    '8303': 'ipm',
    '83275': 'ipm', // Código TOM/SEF informado pelo usuário
    '4216602': 'ipm', // Código IBGE para garantir compatibilidade

    // Adicionar outros municípios conforme necessário
    // Ex: '4205407': 'ipm', // Florianópolis/SC (se usar IPM)

    // Por padrão, municípios não mapeados usarão o provedor Nacional
};

/**
 * Nome/slug da cidade para construção da URL do IPM
 * Formato: https://{cidade}.atende.net:7443/...
 */
export const MUNICIPAL_CODE_TO_CITY_SLUG: Record<string, string> = {
    '8303': 'ws-saojose', // São José/SC (TOM antigo?)
    '83275': 'ws-saojose', // São José/SC (TOM/SEF)
    '4216602': 'ws-saojose', // São José/SC (IBGE)

    // Adicionar outras cidades IPM conforme necessário
};

/**
 * Determina qual provedor NFS-e deve ser usado com base no código municipal
 * @param municipalCode - Código TOM/IBGE do município
 * @returns Tipo do provedor: 'national' ou 'ipm'
 */
export function getProviderType(municipalCode: string): 'national' | 'ipm' {
    return MUNICIPAL_CODE_TO_PROVIDER[municipalCode] || 'national';
}

/**
 * Retorna o slug da cidade para construção da URL do IPM
 * @param municipalCode - Código TOM/IBGE do município
 * @returns Slug da cidade ou null se não for IPM
 */
export function getCitySlug(municipalCode: string): string | null {
    return MUNICIPAL_CODE_TO_CITY_SLUG[municipalCode] || null;
}
