import { DPSData } from '../xml-service';

export interface EmitResult {
    success: boolean;
    invoiceId?: string;
    pdfUrl?: string;
    xmlUrl?: string;
    accessLink?: string; // Link de acesso à NFS-e (usado pelo IPM)
    status: 'authorized' | 'pending' | 'rejected';
    message?: string;
}

export interface NfseProvider {
    emit(data: DPSData, pfxBase64: string, passphrase: string, credentials?: any): Promise<EmitResult>;
    cancel?(numero: string, pfxBase64: string, passphrase: string, credentials?: any): Promise<EmitResult>;
    checkStatus?(numero: string, credentials?: any): Promise<EmitResult>;
}
