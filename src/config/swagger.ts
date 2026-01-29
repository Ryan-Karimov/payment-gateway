import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

// Shared schemas
const schemas = {
  Payment: {
    $id: 'Payment',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      external_id: { type: 'string', nullable: true },
      amount: { type: 'string', description: 'Decimal amount' },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
      },
      provider: { type: 'string', enum: ['stripe', 'paypal'] },
      provider_transaction_id: { type: 'string', nullable: true },
      description: { type: 'string', nullable: true },
      metadata: { type: 'object' },
      webhook_url: { type: 'string', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  PaymentSummary: {
    $id: 'PaymentSummary',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      external_id: { type: 'string', nullable: true },
      amount: { type: 'string' },
      currency: { type: 'string' },
      status: { type: 'string' },
      provider: { type: 'string' },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
  Pagination: {
    $id: 'Pagination',
    type: 'object',
    properties: {
      total: { type: 'integer' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
      has_more: { type: 'boolean' },
    },
  },
  PaymentList: {
    $id: 'PaymentList',
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: 'PaymentSummary#' },
      },
      pagination: { $ref: 'Pagination#' },
    },
  },
  CreatePayment: {
    $id: 'CreatePayment',
    type: 'object',
    required: ['amount', 'currency', 'provider'],
    properties: {
      external_id: { type: 'string', maxLength: 255, description: 'Your unique identifier' },
      amount: { type: 'number', minimum: 0.01, description: 'Payment amount' },
      currency: { type: 'string', minLength: 3, maxLength: 3, description: 'ISO 4217 currency code' },
      provider: { type: 'string', enum: ['stripe', 'paypal'], description: 'Payment provider' },
      description: { type: 'string', maxLength: 1000 },
      metadata: { type: 'object', description: 'Custom metadata' },
      webhook_url: { type: 'string', format: 'uri', description: 'URL for payment notifications' },
    },
  },
  Refund: {
    $id: 'Refund',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      payment_id: { type: 'string', format: 'uuid' },
      amount: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
      reason: { type: 'string', nullable: true },
      provider_refund_id: { type: 'string', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  CreateRefund: {
    $id: 'CreateRefund',
    type: 'object',
    required: ['amount'],
    properties: {
      amount: { type: 'number', minimum: 0.01, description: 'Refund amount' },
      reason: { type: 'string', maxLength: 500, description: 'Reason for refund' },
    },
  },
  RefundableAmount: {
    $id: 'RefundableAmount',
    type: 'object',
    properties: {
      paymentAmount: { type: 'number' },
      totalRefunded: { type: 'number' },
      pendingRefunds: { type: 'number' },
      availableForRefund: { type: 'number' },
    },
  },
  Error: {
    $id: 'Error',
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      code: { type: 'string' },
      details: { type: 'object' },
    },
  },
  HealthCheck: {
    $id: 'HealthCheck',
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['healthy', 'unhealthy'] },
      checks: {
        type: 'object',
        properties: {
          database: { type: 'string' },
          redis: { type: 'string' },
        },
      },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
};

export async function setupSwagger(fastify: FastifyInstance): Promise<void> {
  // Add shared schemas
  for (const schema of Object.values(schemas)) {
    fastify.addSchema(schema);
  }

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Payment Gateway API',
        description: 'Payment Gateway with routing to providers, idempotency, and refunds',
        version: '1.0.0',
        contact: {
          name: 'API Support',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'Payments', description: 'Payment operations' },
        { name: 'Refunds', description: 'Refund operations' },
        { name: 'Webhooks', description: 'Provider webhook endpoints' },
        { name: 'Health', description: 'Health check endpoints' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
            description: 'API key for authentication',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });
}

// OpenAPI schemas for routes
export const paymentSchemas = {
  createPayment: {
    tags: ['Payments'],
    summary: 'Create a new payment',
    description: 'Process a new payment through the specified provider',
    body: { $ref: 'CreatePayment#' },
    response: {
      201: { $ref: 'Payment#' },
      200: { $ref: 'Payment#', description: 'Cached response (idempotent)' },
      400: { $ref: 'Error#' },
      401: { $ref: 'Error#' },
      409: { $ref: 'Error#', description: 'Idempotency conflict' },
    },
  },
  getPayments: {
    tags: ['Payments'],
    summary: 'List payments',
    description: 'Get a paginated list of payments for the merchant',
    querystring: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
        },
      },
    },
    response: {
      200: { $ref: 'PaymentList#' },
      401: { $ref: 'Error#' },
    },
  },
  getPayment: {
    tags: ['Payments'],
    summary: 'Get payment details',
    description: 'Get detailed information about a specific payment',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    response: {
      200: { $ref: 'Payment#' },
      404: { $ref: 'Error#' },
    },
  },
  createRefund: {
    tags: ['Refunds'],
    summary: 'Create a refund',
    description: 'Create a full or partial refund for a payment',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Payment ID' },
      },
    },
    body: { $ref: 'CreateRefund#' },
    response: {
      201: { $ref: 'Refund#' },
      400: { $ref: 'Error#' },
      404: { $ref: 'Error#' },
    },
  },
  getRefund: {
    tags: ['Refunds'],
    summary: 'Get refund details',
    description: 'Get information about a specific refund',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    response: {
      200: { $ref: 'Refund#' },
      404: { $ref: 'Error#' },
    },
  },
  getRefundable: {
    tags: ['Refunds'],
    summary: 'Get refundable amount',
    description: 'Get the amount available for refund on a payment',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Payment ID' },
      },
    },
    response: {
      200: { $ref: 'RefundableAmount#' },
      404: { $ref: 'Error#' },
    },
  },
  providerWebhook: {
    tags: ['Webhooks'],
    summary: 'Receive provider webhook',
    description: 'Endpoint for receiving webhooks from payment providers',
    security: [],
    params: {
      type: 'object',
      required: ['provider'],
      properties: {
        provider: { type: 'string', enum: ['stripe', 'paypal'] },
      },
    },
    response: {
      200: {
        type: 'object',
        properties: {
          received: { type: 'boolean' },
        },
      },
    },
  },
  healthCheck: {
    tags: ['Health'],
    summary: 'Health check',
    description: 'Check the health status of the service',
    security: [],
    response: {
      200: { $ref: 'HealthCheck#' },
      503: { $ref: 'HealthCheck#' },
    },
  },
};
