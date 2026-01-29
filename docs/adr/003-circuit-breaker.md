# ADR 003: Паттерн Circuit Breaker

## Статус

Принято

## Контекст

Внешние платёжные провайдеры (Stripe, PayPal) могут испытывать:
- Временные недоступности
- Высокую задержку
- Rate limiting

Без защиты эти проблемы каскадируются на наш сервис, вызывая:
- Исчерпание пула потоков
- Давление на память от ожидающих запросов
- Плохой пользовательский опыт

## Решение

Мы реализуем **паттерн Circuit Breaker** используя библиотеку `opossum`.

### Состояния

```
CLOSED → OPEN → HALF-OPEN → CLOSED
   ↑                           │
   └───────────────────────────┘
```

1. **CLOSED**: Нормальная работа, запросы проходят
2. **OPEN**: Превышен порог ошибок, запросы отклоняются быстро
3. **HALF-OPEN**: Тестирование восстановления сервиса

### Конфигурация

```typescript
const options = {
  timeout: 10000,              // 10s таймаут запроса
  errorThresholdPercentage: 50, // Открыть при 50% ошибок
  resetTimeout: 30000,          // Попробовать снова через 30s
  volumeThreshold: 5,           // Мин. запросов перед расчётом %
};
```

### Использование

```typescript
const breaker = createCircuitBreaker('stripe', async () => {
  return stripeProvider.processPayment(request);
});

// С fallback
breaker.fallback(() => ({
  success: false,
  error: 'Сервис временно недоступен',
}));

const result = await breaker.fire();
```

### Метрики

События circuit breaker доступны через Prometheus:
- `circuit_breaker_state{name="stripe"}` - Текущее состояние
- `circuit_breaker_failures_total{name="stripe"}` - Количество ошибок
- `circuit_breaker_success_total{name="stripe"}` - Количество успехов

## Рассмотренные альтернативы

### 1. Простой Retry
- **Отклонено**: Не предотвращает каскадные сбои

### 2. Только Timeout
- **Отклонено**: Не останавливает запросы к падающему сервису

### 3. Своя реализация
- **Отклонено**: `opossum` хорошо протестирован и поддерживается

## Последствия

### Положительные
- Быстрый отказ когда провайдер недоступен
- Автоматическое тестирование восстановления
- Предотвращение каскадных сбоев
- Наблюдаемость через метрики

### Отрицательные
- Дополнительная сложность
- Возможны false positives при неправильной конфигурации
- Требует настройки под каждого провайдера

## Ссылки

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Opossum Documentation](https://nodeshift.dev/opossum/)
