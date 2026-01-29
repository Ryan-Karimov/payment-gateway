export interface PaymentRequest {
  amount: number;
  currency: string;
  paymentId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  success: boolean;
  transactionId: string;
  status: 'pending' | 'completed' | 'failed';
  rawResponse: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface RefundRequest {
  transactionId: string;
  amount: number;
  reason?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  status: 'pending' | 'completed' | 'failed';
  rawResponse: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface WebhookEvent {
  type: string;
  transactionId: string;
  status: string;
  rawPayload: Record<string, unknown>;
}

export abstract class BaseProvider {
  abstract readonly name: string;

  abstract processPayment(request: PaymentRequest): Promise<PaymentResponse>;

  abstract processRefund(request: RefundRequest): Promise<RefundResponse>;

  abstract parseWebhook(
    payload: Record<string, unknown>,
    signature?: string
  ): WebhookEvent;

  abstract verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider: string,
    public readonly rawResponse?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
