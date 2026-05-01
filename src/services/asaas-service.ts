import axios, { AxiosInstance } from 'axios';

export interface AsaasConfig {
    apiKey: string;
    environment?: 'sandbox' | 'production';
}

export interface AsaasCustomer {
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
    mobilePhone?: string;
    postalCode?: string;
    address?: string;
    addressNumber?: string;
    complement?: string;
    province?: string;
    city?: string;
    state?: string;
    notificationDisabled?: boolean;
}

export interface AsaasPayment {
    customer: string; // Customer ID
    billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED';
    value: number;
    dueDate: string; // YYYY-MM-DD
    description?: string;
    externalReference?: string;
    installmentCount?: number;
    installmentValue?: number;
    discount?: {
        value?: number;
        dueDateLimitDays?: number;
        type?: 'FIXED' | 'PERCENTAGE';
    };
    fine?: {
        value?: number;
        type?: 'FIXED' | 'PERCENTAGE';
    };
    interest?: {
        value?: number;
        type?: 'PERCENTAGE';
    };
    postalService?: boolean;
    split?: any[];
}

export interface AsaasCreditCardPayment extends AsaasPayment {
    creditCard?: {
        holderName: string;
        number: string;
        expiryMonth: string;
        expiryYear: string;
        ccv: string;
    };
    creditCardHolderInfo?: {
        name: string;
        email: string;
        cpfCnpj: string;
        postalCode: string;
        addressNumber: string;
        addressComplement?: string;
        phone: string;
        mobilePhone?: string;
    };
    remoteIp?: string;
}

export class AsaasClient {
    private client: AxiosInstance;
    private baseURL: string;

    constructor(config: AsaasConfig) {
        // Prioritize config.environment, fallback to process.env, default to sandbox
        const env = config.environment || process.env.NEXT_PUBLIC_ASAAS_ENV || 'sandbox';

        this.baseURL = env === 'production'
            ? 'https://api.asaas.com/v3'
            : 'https://sandbox.asaas.com/api/v3';

        console.log(`[ASAAS CLIENT] Initialized in ${env} mode`);

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
                'access_token': config.apiKey,
            },
        });
    }

    // Customer Management
    async createCustomer(customer: AsaasCustomer) {
        const response = await this.client.post('/customers', customer);
        return response.data;
    }

    async updateCustomer(customerId: string, customer: Partial<AsaasCustomer>) {
        const response = await this.client.post(`/customers/${customerId}`, customer);
        return response.data;
    }

    async getCustomer(customerId: string) {
        const response = await this.client.get(`/customers/${customerId}`);
        return response.data;
    }

    async getCustomerByEmail(email: string) {
        const response = await this.client.get('/customers', {
            params: { email }
        });
        return response.data.data?.[0] || null;
    }

    async getCustomerByCpfCnpj(cpfCnpj: string) {
        const response = await this.client.get('/customers', {
            params: { cpfCnpj }
        });
        return response.data.data?.[0] || null;
    }

    // Payment Management
    async createPayment(payment: AsaasPayment | AsaasCreditCardPayment) {
        const response = await this.client.post('/payments', payment);
        return response.data;
    }

    async getPayment(paymentId: string) {
        const response = await this.client.get(`/payments/${paymentId}`);
        return response.data;
    }


    async getSubscriptionPreviousPayments(subscriptionId: string) {
        const response = await this.client.get(`/subscriptions/${subscriptionId}/payments`);
        return response.data;
    }

    async getPaymentsBySubscription(subscriptionId: string, limit: number = 10) {
        const response = await this.client.get('/payments', {
            params: { subscription: subscriptionId, limit }
        });
        return response.data;
    }


    async getPaymentByExternalReference(externalReference: string) {
        const response = await this.client.get('/payments', {
            params: { externalReference }
        });
        return response.data.data?.[0] || null;
    }

    // Pix QR Code
    async getPixQrCode(paymentId: string) {
        const response = await this.client.get(`/payments/${paymentId}/pixQrCode`);
        return response.data;
    }

    // Boleto
    async getBoletoBarCode(paymentId: string) {
        const response = await this.client.get(`/payments/${paymentId}/identificationField`);
        return response.data;
    }

    // Checkout API
    async createCheckout(payload: any) {
        try {
            const response = await this.client.post('/checkouts', payload);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error creating checkout:', error.response?.data || error.message);
            throw error;
        }
    }

    async getCheckout(checkoutId: string) {
        try {
            const response = await this.client.get(`/checkouts/${checkoutId}`);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error fetching checkout:', error.response?.data || error.message);
            throw error;
        }
    }

    // New Payment Verification Methods
    async getPaymentById(paymentId: string) {
        try {
            const response = await this.client.get(`/payments/${paymentId}`);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error fetching payment:', error.response?.data || error.message);
            throw error;
        }
    }

    async getSubscription(subscriptionId: string) {
        try {
            const response = await this.client.get(`/subscriptions/${subscriptionId}`);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error fetching subscription:', error.response?.data || error.message);
            throw error;
        }
    }

    // Invoice Customization

    async customizeInvoice(config: {
        logoUrl?: string;
        primaryColor?: string;
        secondaryColor?: string;
        fontColor?: string;
        observations?: string;
    }) {
        const response = await this.client.post('/myAccount/paymentCheckoutConfig', config);
        return response.data;
    }

    async getInvoiceCustomization() {
        const response = await this.client.get('/myAccount/paymentCheckoutConfig');
        return response.data;
    }

    // Commercial Info Management
    async getCommercialInfo() {
        const response = await this.client.get('/myAccount/commercialInfo');
        return response.data;
    }

    async updateCommercialInfo(info: {
        email?: string;
        site?: string;
        phone?: string;
        mobilePhone?: string;
    }) {
        const response = await this.client.put('/myAccount/commercialInfo', info);
        return response.data;
    }


    /**
     * Cancelar uma assinatura
     */
    async cancelSubscription(subscriptionId: string) {
        try {
            const response = await this.client.delete(`/subscriptions/${subscriptionId}`);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error canceling subscription:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Criar uma nova assinatura
     */
    async createSubscription(data: {
        customer: string;
        billingType: 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';
        value: number;
        cycle: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
        nextDueDate: string; // YYYY-MM-DD
        description?: string;
        externalReference?: string;
        discount?: {
            value?: number;
            dueDateLimitDays?: number;
            type?: 'FIXED' | 'PERCENTAGE';
            cycles?: number;
        };
        creditCardToken?: string;
        creditCard?: any;
    }) {
        try {
            const response = await this.client.post('/subscriptions', data);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error creating subscription:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Criar um link de pagamento (Flexível)
     */
    async createPaymentLink(data: any) {
        try {
            const response = await this.client.post('/paymentLinks', data);
            return response.data;
        } catch (error: any) {
            console.error('[ASAAS CLIENT] Error creating payment link:', error.response?.data || error.message);
            throw error;
        }
    }

    // Webhook verification
    verifyWebhook(payload: any, signature: string, secret: string): boolean {
        // Asaas doesn't use signature verification by default
        // You can implement custom verification if needed
        return true;
    }
}

export default AsaasClient;
