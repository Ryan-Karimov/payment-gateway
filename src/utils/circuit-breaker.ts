import CircuitBreaker from 'opossum';
import { logger } from './logger.js';
import { providerRequestDuration } from '../config/metrics.js';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

const defaultOptions: CircuitBreakerOptions = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Minimum requests before calculating error percentage
};

const breakers = new Map<string, CircuitBreaker>();

export function createCircuitBreaker<T>(
  name: string,
  fn: (...args: unknown[]) => Promise<T>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker {
  const opts = { ...defaultOptions, ...options };

  const breaker = new CircuitBreaker(fn, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
    volumeThreshold: opts.volumeThreshold,
    name,
  });

  // Event handlers
  breaker.on('success', (result: unknown, latencyMs: number) => {
    logger.debug({ breaker: name, latencyMs }, 'Circuit breaker success');
    providerRequestDuration.observe(
      { provider: name, operation: 'call', status: 'success' },
      latencyMs / 1000
    );
  });

  breaker.on('timeout', (latencyMs: number) => {
    logger.warn({ breaker: name, latencyMs }, 'Circuit breaker timeout');
    providerRequestDuration.observe(
      { provider: name, operation: 'call', status: 'timeout' },
      latencyMs / 1000
    );
  });

  breaker.on('reject', () => {
    logger.warn({ breaker: name }, 'Circuit breaker rejected (open)');
  });

  breaker.on('open', () => {
    logger.error({ breaker: name }, 'Circuit breaker opened');
  });

  breaker.on('halfOpen', () => {
    logger.info({ breaker: name }, 'Circuit breaker half-open');
  });

  breaker.on('close', () => {
    logger.info({ breaker: name }, 'Circuit breaker closed');
  });

  breaker.on('fallback', (result: unknown) => {
    logger.info({ breaker: name, result }, 'Circuit breaker fallback');
  });

  breakers.set(name, breaker);
  return breaker;
}

export function getCircuitBreaker(name: string): CircuitBreaker | undefined {
  return breakers.get(name);
}

export function getCircuitBreakerStats(name: string): CircuitBreakerStats | undefined {
  const breaker = breakers.get(name);
  if (!breaker) return undefined;

  const stats = breaker.stats;
  return {
    name,
    state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
    failures: stats.failures,
    successes: stats.successes,
    rejects: stats.rejects,
    timeouts: stats.timeouts,
    fallbacks: stats.fallbacks,
  };
}

export function getAllCircuitBreakerStats(): CircuitBreakerStats[] {
  return Array.from(breakers.keys())
    .map(name => getCircuitBreakerStats(name))
    .filter((stats): stats is CircuitBreakerStats => stats !== undefined);
}

export interface CircuitBreakerStats {
  name: string;
  state: 'open' | 'half-open' | 'closed';
  failures: number;
  successes: number;
  rejects: number;
  timeouts: number;
  fallbacks: number;
}

/**
 * Wrapper to execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  let breaker = breakers.get(name);

  if (!breaker) {
    breaker = createCircuitBreaker(name, fn);
  }

  if (fallback) {
    breaker.fallback(fallback);
  }

  return breaker.fire() as Promise<T>;
}
