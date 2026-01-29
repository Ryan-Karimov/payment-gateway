import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

// Async local storage for request context
const requestContext = new AsyncLocalStorage<RequestContext>();

export interface RequestContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  merchantId?: string;
  startTime: bigint;
}

declare module 'fastify' {
  interface FastifyRequest {
    requestContext: RequestContext;
  }
}

/**
 * Register request ID middleware on Fastify instance
 */
export function requestIdMiddleware(fastify: import('fastify').FastifyInstance): void {
  fastify.addHook('onRequest', addRequestContext);
  fastify.addHook('onSend', requestIdResponseHook);
}

/**
 * Hook to add request context
 */
async function addRequestContext(
  request: FastifyRequest
): Promise<void> {
  // Get or generate request ID
  const requestId =
    (request.headers['x-request-id'] as string) ||
    (request.headers['x-correlation-id'] as string) ||
    uuidv4();

  // Get trace context from headers (OpenTelemetry compatible)
  const traceParent = request.headers['traceparent'] as string | undefined;
  let traceId: string | undefined;
  let spanId: string | undefined;

  if (traceParent) {
    // Parse W3C Trace Context format: version-traceId-spanId-flags
    const parts = traceParent.split('-');
    if (parts.length >= 3) {
      traceId = parts[1];
      spanId = parts[2];
    }
  }

  const context: RequestContext = {
    requestId,
    traceId,
    spanId,
    startTime: process.hrtime.bigint(),
  };

  request.requestContext = context;

  // Run the rest of the request in async local storage context
  requestContext.enterWith(context);
}

/**
 * Hook to add request ID to response headers
 */
export async function requestIdResponseHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.requestContext) {
    reply.header('x-request-id', request.requestContext.requestId);
    if (request.requestContext.traceId) {
      reply.header('x-trace-id', request.requestContext.traceId);
    }
  }
}

/**
 * Get current request context from async local storage
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Get current request ID
 */
export function getRequestId(): string | undefined {
  return getRequestContext()?.requestId;
}

/**
 * Run a function with a specific request context
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return requestContext.run(context, fn);
}

/**
 * Create a child logger with request context
 */
export function withRequestContext(logData: Record<string, unknown>): Record<string, unknown> {
  const context = getRequestContext();
  if (!context) return logData;

  return {
    ...logData,
    requestId: context.requestId,
    traceId: context.traceId,
    merchantId: context.merchantId,
  };
}
