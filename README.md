# Payment Gateway

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-black?logo=fastify)](https://www.fastify.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io/)
[![MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Платёжный шлюз с маршрутизацией на провайдеров, идемпотентностью, доставкой вебхуков и мониторингом.

## Возможности

- **Мульти-провайдеры** — роутинг на Stripe/PayPal с failover
- **Идемпотентность** — exactly-once через Redis + PostgreSQL
- **Частичные возвраты** — полные и частичные рефанды
- **Вебхуки** — доставка с retry и HMAC подписями
- **Circuit Breaker** — защита от сбоев провайдеров
- **Rate Limiting** — лимиты по мерчантам
- **Трассировка** — OpenTelemetry + Jaeger
- **Метрики** — Prometheus + Grafana
- **Аудит** — логирование всех операций

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Payment Gateway                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────────┐   │
│  │  Fastify │───▶│  Middleware  │───▶│     Route Handlers      │   │
│  │  Server  │    │ (Auth/Rate)  │    │  (Payments/Refunds)     │   │
│  └──────────┘    └──────────────┘    └───────────┬─────────────┘   │
│                                                   │                  │
│                         ┌─────────────────────────┼──────────────┐  │
│                         ▼                         ▼              ▼  │
│              ┌──────────────────┐    ┌────────────────┐  ┌───────┐ │
│              │  Payment Service │    │ Refund Service │  │ Saga  │ │
│              │  (Idempotency)   │    │                │  │       │ │
│              └────────┬─────────┘    └───────┬────────┘  └───┬───┘ │
│                       │                      │               │      │
│         ┌─────────────┴──────────────────────┴───────────────┘      │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Слой провайдеров                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │   │
│  │  │   Stripe    │  │   PayPal    │  │   Circuit Breaker    │ │   │
│  │  │  Provider   │  │  Provider   │  │   (на провайдера)    │ │   │
│  │  └─────────────┘  └─────────────┘  └──────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                    │                │                │
                    ▼                ▼                ▼
            ┌────────────┐   ┌────────────┐   ┌────────────┐
            │ PostgreSQL │   │   Redis    │   │  RabbitMQ  │
            │  (данные)  │   │   (кэш)    │   │ (вебхуки)  │
            └────────────┘   └────────────┘   └────────────┘
```

## Быстрый старт

### Требования

- Node.js 20+
- Docker и Docker Compose
- Git

### Установка

```bash
git clone https://github.com/yourusername/payment-gateway.git
cd payment-gateway

docker-compose up -d
npm install
npm run migrate
npm run dev
```

Сервер запустится на `http://localhost:3000`

### Проверка

```bash
curl http://localhost:3000/health
# {"status":"healthy","checks":{"database":"ok","redis":"ok"},"timestamp":"..."}
```

## API

### Аутентификация

Все запросы требуют заголовок `X-API-Key`:

```bash
curl -H "X-API-Key: ваш-api-ключ" http://localhost:3000/api/v1/payments
```

### Создание платежа

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ваш-api-ключ" \
  -H "Idempotency-Key: уникальный-id-запроса" \
  -d '{
    "amount": 100.00,
    "currency": "USD",
    "provider": "stripe",
    "description": "Заказ #12345",
    "metadata": {
      "order_id": "12345",
      "customer_email": "customer@example.com"
    },
    "callback_url": "https://your-site.com/webhooks"
  }'
```

Ответ:
```json
{
  "id": "pay_1234567890",
  "external_id": null,
  "amount": "100.0000",
  "currency": "USD",
  "status": "completed",
  "provider": "stripe",
  "provider_transaction_id": "ch_abc123",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Получение платежа

```bash
curl http://localhost:3000/api/v1/payments/pay_1234567890 \
  -H "X-API-Key: ваш-api-ключ"
```

### Список платежей

```bash
curl "http://localhost:3000/api/v1/payments?limit=10&offset=0&status=completed" \
  -H "X-API-Key: ваш-api-ключ"
```

### Создание возврата

```bash
curl -X POST http://localhost:3000/api/v1/payments/pay_1234567890/refunds \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ваш-api-ключ" \
  -d '{
    "amount": 50.00,
    "reason": "Запрос клиента"
  }'
```

Swagger UI: `/docs`

## Конфигурация

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт сервера | `3000` |
| `HOST` | Хост сервера | `0.0.0.0` |
| `NODE_ENV` | Окружение | `development` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `RABBITMQ_URL` | RabbitMQ connection string | `amqp://localhost:5672` |
| `WEBHOOK_SECRET` | Секрет для HMAC подписей | - |
| `TRACING_ENABLED` | Включить трассировку | `false` |
| `JAEGER_ENDPOINT` | Jaeger endpoint | `http://localhost:14268/api/traces` |
| `SENTRY_DSN` | Sentry DSN | - |

Полный список в `.env.example`

## Мониторинг

| Сервис | URL | Логин/Пароль |
|--------|-----|--------------|
| Grafana | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | - |
| Jaeger UI | http://localhost:16686 | - |
| RabbitMQ | http://localhost:15672 | guest / guest |

### Метрики

```
payment_requests_total{provider,status}
payment_request_duration_seconds{provider}
payment_amount_total{currency}
provider_request_duration_seconds{provider,operation}
circuit_breaker_state{name}
http_requests_total{method,path,status}
http_request_duration_seconds{method,path}
```

## Тестирование

```bash
npm test                              # все тесты
npm run test:coverage                 # с покрытием
npm test -- tests/unit/crypto.test.ts # конкретный файл
npm run load-test                     # нагрузочные (k6)
```

| Категория | Тестов | Покрытие |
|-----------|--------|----------|
| Unit | 121 | ~85% |
| Интеграционные | 9 | ~75% |
| **Всего** | **130** | **~80%** |

## Деплой

### Docker

```bash
docker build -t payment-gateway .

docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  payment-gateway
```

### Kubernetes

```bash
kubectl apply -f k8s/
kubectl get pods -n payment-gateway
```

Манифесты включают: Deployment, Service, Ingress, HPA, PDB, ConfigMap, Secret.

## Структура проекта

```
payment-gateway/
├── src/
│   ├── config/          # Конфигурация
│   ├── db/              # Миграции
│   ├── middleware/      # Middleware
│   ├── models/          # Модели данных
│   ├── providers/       # Провайдеры
│   ├── routes/          # API роуты
│   ├── services/        # Бизнес-логика
│   ├── utils/           # Утилиты
│   ├── workers/         # Воркеры
│   └── app.ts           # Точка входа
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
├── k8s/
├── monitoring/
├── docs/
│   └── adr/
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Архитектурные решения (ADR)

- [ADR-001: Saga Pattern](docs/adr/001-saga-pattern.md)
- [ADR-002: Idempotency](docs/adr/002-idempotency.md)
- [ADR-003: Circuit Breaker](docs/adr/003-circuit-breaker.md)

## Безопасность

- API ключи с SHA-256 хэшированием
- HMAC-SHA256 подписи вебхуков
- Rate limiting через Redis
- Timing-safe сравнение строк
- SSRF защита для callback URL
- Non-root пользователь в контейнере

## Технологии

- Node.js 20+
- Fastify 4.x
- TypeScript 5.x
- PostgreSQL 16
- Redis 7
- RabbitMQ 3
- Prometheus + Grafana
- OpenTelemetry + Jaeger
- Sentry
- Docker + Kubernetes

## Лицензия

MIT — см. [LICENSE](LICENSE)
