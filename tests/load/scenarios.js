import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const paymentSuccessRate = new Rate('payment_success_rate');
const paymentDuration = new Trend('payment_duration');
const refundSuccessRate = new Rate('refund_success_rate');
const totalPayments = new Counter('total_payments');

// Test configuration
export const options = {
  scenarios: {
    // Smoke test - basic functionality
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { test_type: 'smoke' },
      exec: 'smokeTest',
    },
    // Load test - normal traffic
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },  // Ramp up
        { duration: '5m', target: 50 },  // Stay at 50
        { duration: '2m', target: 0 },   // Ramp down
      ],
      tags: { test_type: 'load' },
      exec: 'loadTest',
      startTime: '35s',
    },
    // Stress test - high traffic
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '2m', target: 0 },
      ],
      tags: { test_type: 'stress' },
      exec: 'stressTest',
      startTime: '10m',
    },
    // Spike test - sudden traffic
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '10s', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '10s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '10s', target: 0 },
      ],
      tags: { test_type: 'spike' },
      exec: 'spikeTest',
      startTime: '25m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    payment_success_rate: ['rate>0.95'],
    payment_duration: ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'sk_test_a1b2c3d4e5f6g7h8i9j0';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

// Generate unique idempotency key
function generateIdempotencyKey() {
  return `k6-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create a payment
function createPayment(amount, currency, provider) {
  const payload = JSON.stringify({
    amount: amount,
    currency: currency,
    provider: provider,
    description: 'K6 load test payment',
    metadata: {
      test: true,
      vu: __VU,
      iter: __ITER,
    },
  });

  const requestHeaders = {
    ...headers,
    'Idempotency-Key': generateIdempotencyKey(),
  };

  const startTime = Date.now();
  const response = http.post(`${BASE_URL}/api/v1/payments`, payload, {
    headers: requestHeaders,
  });
  const duration = Date.now() - startTime;

  paymentDuration.add(duration);
  totalPayments.add(1);

  const success = check(response, {
    'payment created': (r) => r.status === 201 || r.status === 200,
    'has payment id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  paymentSuccessRate.add(success);

  if (success) {
    try {
      return JSON.parse(response.body);
    } catch {
      return null;
    }
  }
  return null;
}

// Get payment details
function getPayment(paymentId) {
  const response = http.get(`${BASE_URL}/api/v1/payments/${paymentId}`, {
    headers: headers,
  });

  check(response, {
    'get payment success': (r) => r.status === 200,
  });

  return response;
}

// List payments
function listPayments(limit = 10) {
  const response = http.get(`${BASE_URL}/api/v1/payments?limit=${limit}`, {
    headers: headers,
  });

  check(response, {
    'list payments success': (r) => r.status === 200,
    'has data array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data);
      } catch {
        return false;
      }
    },
  });

  return response;
}

// Create refund
function createRefund(paymentId, amount) {
  const payload = JSON.stringify({
    amount: amount,
    reason: 'K6 load test refund',
  });

  const requestHeaders = {
    ...headers,
    'Idempotency-Key': generateIdempotencyKey(),
  };

  const response = http.post(
    `${BASE_URL}/api/v1/payments/${paymentId}/refunds`,
    payload,
    { headers: requestHeaders }
  );

  const success = check(response, {
    'refund created': (r) => r.status === 201 || r.status === 200,
  });

  refundSuccessRate.add(success);

  return response;
}

// Health check
function healthCheck() {
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    'health check success': (r) => r.status === 200,
    'is healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy';
      } catch {
        return false;
      }
    },
  });

  return response;
}

// Smoke test scenario
export function smokeTest() {
  group('Smoke Test', () => {
    healthCheck();
    sleep(1);

    const payment = createPayment(10.00, 'USD', 'stripe');
    if (payment && payment.id) {
      sleep(0.5);
      getPayment(payment.id);
    }
    sleep(1);
  });
}

// Load test scenario
export function loadTest() {
  group('Load Test', () => {
    // 70% create payments
    if (Math.random() < 0.7) {
      const provider = Math.random() < 0.6 ? 'stripe' : 'paypal';
      const amount = Math.floor(Math.random() * 1000) + 1;
      const currency = Math.random() < 0.8 ? 'USD' : 'EUR';

      const payment = createPayment(amount, currency, provider);

      // 20% of successful payments get a refund
      if (payment && payment.id && payment.status === 'completed' && Math.random() < 0.2) {
        sleep(0.5);
        createRefund(payment.id, amount / 2);
      }
    }
    // 20% list payments
    else if (Math.random() < 0.67) {
      listPayments(20);
    }
    // 10% health check
    else {
      healthCheck();
    }

    sleep(Math.random() * 2 + 0.5);
  });
}

// Stress test scenario
export function stressTest() {
  group('Stress Test', () => {
    const provider = Math.random() < 0.5 ? 'stripe' : 'paypal';
    const amount = Math.floor(Math.random() * 500) + 1;

    createPayment(amount, 'USD', provider);
    sleep(Math.random() * 0.5);
  });
}

// Spike test scenario
export function spikeTest() {
  group('Spike Test', () => {
    createPayment(100, 'USD', 'stripe');
    sleep(Math.random() * 0.2);
  });
}

// Setup - runs once before the test
export function setup() {
  console.log('Starting load test...');
  console.log(`Base URL: ${BASE_URL}`);

  // Verify the service is running
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    throw new Error('Service is not healthy');
  }

  return { startTime: Date.now() };
}

// Teardown - runs once after the test
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration}s`);
}
