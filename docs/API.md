# Документация API

Полная справка по API Payment Gateway.

## Базовый URL

```
Разработка: http://localhost:3000
Продакшн:   https://api.yourdomain.com
```

## Аутентификация

Все API запросы требуют аутентификации через API ключ.

### Заголовок

```
X-API-Key: ваш_api_ключ
```

### Пример

```bash
curl -H "X-API-Key: sk_live_abc123..." https://api.yourdomain.com/api/v1/payments
```

### Ответ при ошибке (401)

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Неверный или отсутствующий API ключ"
  }
}
```

---

## Платежи

### Создание платежа

Создаёт новый платёжный запрос.

```
POST /api/v1/payments
```

#### Заголовки

| Заголовок | Обязательный | Описание |
|-----------|--------------|----------|
| `X-API-Key` | Да | Ваш API ключ |
| `Idempotency-Key` | Рекомендуется | Уникальный ключ для идемпотентных запросов |
| `Content-Type` | Да | `application/json` |

#### Тело запроса

| Поле | Тип | Обязательный | Описание |
|------|-----|--------------|----------|
| `amount` | number | Да | Сумма платежа (положительное число) |
| `currency` | string | Да | Код валюты ISO 4217 (например, "USD") |
| `provider` | string | Да | Платёжный провайдер: `stripe` или `paypal` |
| `description` | string | Нет | Описание платежа |
| `external_id` | string | Нет | Ваш референс ID |
| `metadata` | object | Нет | Произвольные данные ключ-значение |
| `callback_url` | string | Нет | URL для webhook уведомлений |

#### Пример запроса

```bash
curl -X POST https://api.yourdomain.com/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_abc123" \
  -H "Idempotency-Key: order_12345_payment" \
  -d '{
    "amount": 99.99,
    "currency": "USD",
    "provider": "stripe",
    "description": "Заказ #12345",
    "external_id": "order_12345",
    "metadata": {
      "customer_id": "cust_789",
      "product": "Премиум план"
    },
    "callback_url": "https://yoursite.com/webhooks/payments"
  }'
```

#### Успешный ответ (201)

```json
{
  "id": "pay_7f3b8c2a1d4e5f6g",
  "external_id": "order_12345",
  "amount": "99.9900",
  "currency": "USD",
  "status": "completed",
  "provider": "stripe",
  "provider_transaction_id": "ch_3abc123def456",
  "description": "Заказ #12345",
  "metadata": {
    "customer_id": "cust_789",
    "product": "Премиум план"
  },
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:01.500Z"
}
```

#### Ответы при ошибках

**400 Bad Request**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Неверный код валюты",
    "details": [
      {
        "field": "currency",
        "message": "должен быть валидным кодом валюты ISO 4217"
      }
    ]
  }
}
```

**409 Conflict (Идемпотентность)**
```json
{
  "success": false,
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "Запрос с этим ключом идемпотентности уже обработан с другими параметрами"
  }
}
```

---

### Получение платежа

Получает платёж по ID.

```
GET /api/v1/payments/:id
```

#### Пример запроса

```bash
curl https://api.yourdomain.com/api/v1/payments/pay_7f3b8c2a1d4e5f6g \
  -H "X-API-Key: sk_live_abc123"
```

#### Успешный ответ (200)

```json
{
  "id": "pay_7f3b8c2a1d4e5f6g",
  "external_id": "order_12345",
  "amount": "99.9900",
  "currency": "USD",
  "status": "completed",
  "provider": "stripe",
  "provider_transaction_id": "ch_3abc123def456",
  "description": "Заказ #12345",
  "metadata": {},
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:01.500Z",
  "transactions": [
    {
      "id": "txn_abc123",
      "status": "completed",
      "provider_response": {},
      "created_at": "2024-01-15T10:30:01.000Z"
    }
  ],
  "refunds": []
}
```

---

### Список платежей

Получает пагинированный список платежей.

```
GET /api/v1/payments
```

#### Query параметры

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `limit` | integer | 20 | Результатов на странице (1-100) |
| `offset` | integer | 0 | Количество пропускаемых результатов |
| `status` | string | - | Фильтр по статусу |
| `provider` | string | - | Фильтр по провайдеру |
| `from` | string | - | Начальная дата (ISO 8601) |
| `to` | string | - | Конечная дата (ISO 8601) |

#### Пример запроса

```bash
curl "https://api.yourdomain.com/api/v1/payments?limit=10&status=completed" \
  -H "X-API-Key: sk_live_abc123"
```

#### Успешный ответ (200)

```json
{
  "data": [
    {
      "id": "pay_7f3b8c2a1d4e5f6g",
      "amount": "99.9900",
      "currency": "USD",
      "status": "completed",
      "provider": "stripe",
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

---

## Возвраты

### Создание возврата

Создаёт возврат для платежа.

```
POST /api/v1/payments/:id/refunds
```

#### Тело запроса

| Поле | Тип | Обязательный | Описание |
|------|-----|--------------|----------|
| `amount` | number | Да | Сумма возврата (не более доступной суммы) |
| `reason` | string | Нет | Причина возврата |

#### Пример запроса

```bash
curl -X POST https://api.yourdomain.com/api/v1/payments/pay_7f3b8c2a1d4e5f6g/refunds \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_abc123" \
  -d '{
    "amount": 25.00,
    "reason": "Запрос клиента на частичный возврат"
  }'
```

#### Успешный ответ (201)

```json
{
  "id": "ref_9h8g7f6e5d4c3b2a",
  "payment_id": "pay_7f3b8c2a1d4e5f6g",
  "amount": "25.0000",
  "currency": "USD",
  "status": "completed",
  "reason": "Запрос клиента на частичный возврат",
  "created_at": "2024-01-16T14:20:00.000Z"
}
```

---

### Получение возврата

```
GET /api/v1/refunds/:id
```

---

### Получение доступной суммы для возврата

Проверяет, сколько можно вернуть по платежу.

```
GET /api/v1/payments/:id/refundable
```

#### Успешный ответ (200)

```json
{
  "payment_id": "pay_7f3b8c2a1d4e5f6g",
  "original_amount": 99.99,
  "refunded_amount": 25.00,
  "refundable_amount": 74.99,
  "currency": "USD"
}
```

---

## Вебхуки

### События вебхуков

| Событие | Описание |
|---------|----------|
| `payment.created` | Платёж создан |
| `payment.completed` | Платёж успешно обработан |
| `payment.failed` | Обработка платежа не удалась |
| `refund.created` | Возврат инициирован |
| `refund.completed` | Возврат обработан |
| `refund.failed` | Обработка возврата не удалась |

### Payload вебхука

```json
{
  "id": "evt_abc123",
  "type": "payment.completed",
  "created_at": "2024-01-15T10:30:01.500Z",
  "data": {
    "id": "pay_7f3b8c2a1d4e5f6g",
    "amount": "99.9900",
    "currency": "USD",
    "status": "completed"
  }
}
```

### Заголовки вебхука

| Заголовок | Описание |
|-----------|----------|
| `X-Webhook-Signature` | HMAC-SHA256 подпись |
| `X-Webhook-Timestamp` | Unix timestamp |
| `X-Webhook-ID` | Уникальный ID доставки вебхука |

### Верификация подписей

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, timestamp, secret) {
  const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

---

## Коды статусов

| Код | Описание |
|-----|----------|
| `200` | Успех |
| `201` | Создано |
| `400` | Неверный запрос |
| `401` | Не авторизован |
| `403` | Запрещено |
| `404` | Не найдено |
| `409` | Конфликт |
| `429` | Превышен лимит запросов |
| `500` | Внутренняя ошибка сервера |

---

## Лимиты запросов

| Endpoint | Лимит |
|----------|-------|
| Создание платежа | 100/минута |
| Получение платежа | 1000/минута |
| Список платежей | 100/минута |
| Создание возврата | 50/минута |

Заголовки лимитов:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312800
```

---

## Статусы платежей

| Статус | Описание |
|--------|----------|
| `pending` | Платёж создан, ожидает обработки |
| `processing` | Платёж обрабатывается |
| `completed` | Платёж успешен |
| `failed` | Платёж не удался |
| `refunded` | Полностью возвращён |
| `partially_refunded` | Частично возвращён |

---

## Идемпотентность

Используйте заголовок `Idempotency-Key` для гарантии однократной обработки запросов.

- Ключи должны быть уникальными для каждого типа запроса
- Ключи истекают через 24 часа
- Повторное использование ключа с другими параметрами возвращает 409 Conflict

```bash
curl -X POST /api/v1/payments \
  -H "Idempotency-Key: unique-request-id-12345" \
  ...
```

---

## SDK

Официальные SDK в разработке:
- Node.js
- Python
- Go
- PHP

---

## Поддержка

- Документация: endpoint `/docs`
- Статус API: `status.yourdomain.com`
- Email: support@yourdomain.com
