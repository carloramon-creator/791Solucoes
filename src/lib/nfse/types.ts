export interface DPSData {
    numero: string;
    serie: string;
    dataEmissao: string;
    prestador: {
        cnpj: string;
        razaoSocial?: string;
        inscricaoMunicipal?: string;
        endereco?: {
            logradouro?: string;
            numero?: string;
            bairro?: string;
            cidade?: string;
            uf?: string;
            cep?: string;
        };
    };
    tomador: {
        cnpj?: string;
        cpf?: string;
        razaoSocial: string;
        email?: string;
        inscricaoMunicipal?: string;
        endereco?: {
            logradouro?: string;
            numero?: string;
            bairro?: string;
            cidade?: string;
            uf?: string;
            cep?: string;
        };
    };
    servico: {
        valorServicos: number;
        codigoItemListaServico: string;
        discriminacao: string;
        aliquota?: number;
    };
}

export interface EmitResult {
    success: boolean;
    status: 'authorized' | 'rejected' | 'pending' | 'cancelled';
    message: string;
    invoiceId: string;
    accessLink?: string;
    xml?: string;
}

export interface NfseProvider {
    emit(data: DPSData, pfxBase64: string, passphrase: string, credentials?: any): Promise<EmitResult>;
    cancel?(numero: string, pfxBase64: string, passphrase: string, credentials?: any): Promise<EmitResult>;
    checkStatus?(numero: string, credentials?: any): Promise<EmitResult>;
}
