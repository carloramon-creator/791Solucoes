import axios from 'axios';
import * as https from 'https';

interface InterConfigV2 {
    clientId: string;
    clientSecret: string;
    cert: string;
    key: string;
    environment?: 'sandbox' | 'production'; // Default: production
}

export class InterAPIV2 {
    private config: InterConfigV2;
    private accessToken: string | null = null;
    private tokenExpiresAt: number = 0;

    constructor(config: InterConfigV2) {
        this.config = config;
    }

    private getAgent() {
        return new https.Agent({
            cert: this.config.cert,
            key: this.config.key,
            keepAlive: true,
            rejectUnauthorized: false,
            family: 4, // Force IPv4 to avoid Vercel IPv6 DNS issues
            lookup: (hostname, options, callback) => {
                // Custom DNS lookup to handle Vercel DNS issues
                const dns = require('dns');
                dns.lookup(hostname, { family: 4, all: false }, callback);
            }
        });
    }

    private getBaseUrl(): string {
        const env = this.config.environment || 'production';
        return env === 'sandbox'
            ? 'https://cdpj-sandbox.partners.bancointer.com.br'
            : 'https://cdp.inter.co';
    }

    private getTokenUrl(): string {
        return `${this.getBaseUrl()}/oauth/v2/token`;
    }

    private getBillingUrl(): string {
        return `${this.getBaseUrl()}/cobranca/v3/cobrancas`;
    }

    async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        const params = new URLSearchParams();
        params.append('client_id', this.config.clientId);
        params.append('client_secret', this.config.clientSecret);
        params.append('scope', 'pix.read pix.write webhook.read webhook.write boleto-cobranca.read boleto-cobranca.write');
        params.append('grant_type', 'client_credentials');

        console.log('[INTER V2] Requesting Token from: https://cdp.inter.co/oauth/v2/token');

        try {
            const response = await axios.post('https://cdp.inter.co/oauth/v2/token', params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Host': 'cdp.inter.co'
                },
                httpsAgent: this.getAgent(),
                timeout: 30000
            });

            const data = response.data;
            this.accessToken = data.access_token;
            this.tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000;
            return this.accessToken!;
        } catch (error: any) {
            console.error('[INTER V2] Auth Error:', error.message);
            if (error.response) console.error('[INTER V2] Auth Response:', error.response.data);
            throw new Error(`Inter Auth Error: ${JSON.stringify(error.response?.data || error.message)}`);
        }
    }

    async createBilling(payload: any) {
        const token = await this.getAccessToken();
        const url = 'https://cdp.inter.co/cobranca/v3/cobrancas';

        console.log('[INTER V2] Creating Billing at:', url);
        console.log('[INTER V2] Payload:', JSON.stringify(payload, null, 2));

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Host': 'cdp.inter.co'
                },
                httpsAgent: this.getAgent(),
                timeout: 30000
            });

            console.log('[INTER V2] Billing Success:', JSON.stringify(response.data));
            return response.data;
        } catch (error: any) {
            console.error('[INTER V2] Billing Error:', error.message);
            console.error('[INTER V2] Error Response:', JSON.stringify(error.response?.data, null, 2));
            console.error('[INTER V2] Error Status:', error.response?.status);
            console.error('[INTER V2] Error Headers:', JSON.stringify(error.response?.headers, null, 2));

            const errorDetails = {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
                url: url
            };

            throw new Error(`Inter Billing Error: ${JSON.stringify(errorDetails)}`);
        }
    }
}
