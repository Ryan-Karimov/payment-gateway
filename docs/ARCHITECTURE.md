# Обзор архитектуры

## Системная архитектура

```mermaid
flowchart TB
    subgraph Client
        A[Клиентское приложение]
    end

    subgraph Gateway["Payment Gateway"]
        B[Fastify Server]
        C[Middleware Layer]
        D[Route Handlers]
        E[Payment Service]
        F[Refund Service]
        G[Webhook Service]
        H[Saga Orchestrator]
        I[Idempotency Service]
    end

    subgraph Providers["Платёжные провайдеры"]
        J[Stripe Provider]
        K[PayPal Provider]
        L[Circuit Breaker]
    end

    subgraph Storage["Слой данных"]
        M[(PostgreSQL)]
        N[(Redis)]
        O[RabbitMQ]
    end

    subgraph Observability["Наблюдаемость"]
        P[Prometheus]
        Q[Grafana]
        R[Jaeger]
        S[Sentry]
    end

    A -->|HTTPS| B
    B --> C
    C --> D
    D --> E & F
    E --> H
    E --> I
    H --> J & K
    J & K --> L
    E & F & G --> M
    I --> N
    G --> O
    B --> P
    P --> Q
    B --> R
    B --> S
```

## Поток запроса

```mermaid
sequenceDiagram
    participant C as Клиент
    participant G as Gateway
    participant I as Idempotency
    participant S as Saga
    participant P as Провайдер
    participant DB as PostgreSQL
    participant R as Redis
    participant W as Webhook Worker

    C->>G: POST /payments
    G->>I: Проверка idempotency key
    I->>R: Получить из кэша
    alt Кэш hit
        R-->>I: Вернуть кэшированный ответ
        I-->>G: Вернуть кэшированный ответ
        G-->>C: 200 OK (кэшировано)
    else Кэш miss
        I->>DB: Проверить в persistent storage
        alt Уже обработано
            DB-->>I: Вернуть сохранённый ответ
            I-->>G: Вернуть сохранённый ответ
            G-->>C: 200 OK (из БД)
        else Новый запрос
            I->>R: Заблокировать ключ
            G->>S: Выполнить payment saga
            S->>DB: Создать запись платежа
            S->>P: Обработать через провайдера
            P-->>S: Ответ провайдера
            S->>DB: Обновить статус платежа
            S->>I: Сохранить результат
            I->>R: Закэшировать результат
            G->>W: Поставить webhook в очередь
            G-->>C: 201 Created
        end
    end
```

## Saga паттерн

```mermaid
stateDiagram-v2
    [*] --> CreatePayment
    CreatePayment --> ProcessProvider: Успех
    CreatePayment --> Failed: Ошибка

    ProcessProvider --> UpdateStatus: Успех
    ProcessProvider --> CompensatePayment: Ошибка

    UpdateStatus --> SendWebhook: Успех
    UpdateStatus --> CompensateProvider: Ошибка

    SendWebhook --> [*]: Завершено

    CompensatePayment --> Failed
    CompensateProvider --> CompensatePayment
    Failed --> [*]
```

## Состояния Circuit Breaker

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: Превышен порог ошибок
    Open --> HalfOpen: Истёк timeout сброса
    HalfOpen --> Closed: Запрос успешен
    HalfOpen --> Open: Запрос неудачен
```

## Модель данных

```mermaid
erDiagram
    PAYMENTS {
        uuid id PK
        varchar external_id
        varchar merchant_id FK
        decimal amount
        varchar currency
        varchar status
        varchar provider
        varchar provider_transaction_id
        jsonb metadata
        varchar callback_url
        timestamp created_at
        timestamp updated_at
    }

    TRANSACTIONS {
        uuid id PK
        uuid payment_id FK
        varchar status
        jsonb provider_response
        varchar error_message
        timestamp created_at
    }

    REFUNDS {
        uuid id PK
        uuid payment_id FK
        decimal amount
        varchar currency
        varchar status
        text reason
        varchar provider_refund_id
        timestamp created_at
    }

    IDEMPOTENCY_KEYS {
        varchar key PK
        varchar merchant_id
        varchar request_hash
        varchar status
        jsonb response
        integer status_code
        timestamp expires_at
        timestamp created_at
    }

    WEBHOOK_EVENTS {
        uuid id PK
        uuid payment_id FK
        varchar event_type
        jsonb payload
        varchar url
        integer attempts
        varchar status
        timestamp next_retry_at
        timestamp created_at
    }

    API_KEYS {
        uuid id PK
        varchar key_hash
        varchar merchant_id
        varchar name
        jsonb permissions
        boolean is_active
        timestamp last_used_at
        timestamp created_at
    }

    AUDIT_LOGS {
        uuid id PK
        varchar entity_type
        uuid entity_id
        varchar action
        jsonb old_value
        jsonb new_value
        varchar actor
        varchar actor_type
        varchar ip_address
        timestamp created_at
    }

    PAYMENTS ||--o{ TRANSACTIONS : имеет
    PAYMENTS ||--o{ REFUNDS : имеет
    PAYMENTS ||--o{ WEBHOOK_EVENTS : генерирует
    API_KEYS ||--o{ PAYMENTS : создаёт
```

## Архитектура деплоя

```mermaid
flowchart TB
    subgraph Internet
        U[Пользователи]
    end

    subgraph Cloud["Облачная инфраструктура"]
        subgraph LB["Load Balancer"]
            LB1[Ingress Controller]
        end

        subgraph K8s["Kubernetes кластер"]
            subgraph Pods["Payment Gateway Pods"]
                P1[Pod 1]
                P2[Pod 2]
                P3[Pod 3]
            end

            subgraph Workers["Worker Pods"]
                W1[Webhook Worker 1]
                W2[Webhook Worker 2]
            end
        end

        subgraph Data["Управляемые сервисы"]
            DB[(PostgreSQL)]
            Cache[(Redis)]
            Queue[RabbitMQ]
        end

        subgraph Monitor["Мониторинг"]
            Prom[Prometheus]
            Graf[Grafana]
            Jaeg[Jaeger]
        end
    end

    U -->|HTTPS| LB1
    LB1 --> P1 & P2 & P3
    P1 & P2 & P3 --> DB & Cache
    P1 & P2 & P3 --> Queue
    Queue --> W1 & W2
    W1 & W2 --> DB
    P1 & P2 & P3 --> Prom
    Prom --> Graf
    P1 & P2 & P3 --> Jaeg
```

## Слои безопасности

```mermaid
flowchart LR
    subgraph External
        C[Клиент]
    end

    subgraph Security["Слои безопасности"]
        TLS[TLS 1.3]
        RL[Rate Limiter]
        Auth[API Key Auth]
        Val[Валидация входных данных]
    end

    subgraph App["Приложение"]
        H[Handler]
    end

    C -->|HTTPS| TLS
    TLS --> RL
    RL --> Auth
    Auth --> Val
    Val --> H
```

## Технологический стек

| Слой | Технология |
|------|------------|
| Runtime | Node.js 20 |
| Фреймворк | Fastify 4.x |
| Язык | TypeScript 5.x |
| База данных | PostgreSQL 16 |
| Кэш | Redis 7 |
| Очередь сообщений | RabbitMQ 3 |
| Метрики | Prometheus |
| Дашборды | Grafana |
| Трассировка | OpenTelemetry + Jaeger |
| Ошибки | Sentry |
| Контейнеризация | Docker |
| Оркестрация | Kubernetes |
