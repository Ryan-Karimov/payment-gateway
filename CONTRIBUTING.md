# Участие в разработке

## Содержание

- [Начало работы](#начало-работы)
- [Настройка окружения](#настройка-окружения)
- [Внесение изменений](#внесение-изменений)
- [Отправка изменений](#отправка-изменений)
- [Стандарты кода](#стандарты-кода)
- [Тестирование](#тестирование)

## Начало работы

### Поиск задач

- Ищите issues с меткой `good first issue` для простых задач
- Issues с меткой `help wanted` открыты для контрибьюторов
- Задавайте вопросы в любом issue

### Сообщение об ошибках

При создании баг-репорта укажите:

- **Чёткий заголовок** с описанием проблемы
- **Шаги воспроизведения**
- **Ожидаемое поведение** vs фактическое
- **Детали окружения** (ОС, версия Node.js и т.д.)
- **Логи** или сообщения об ошибках

### Предложение функций

Опишите:

- **Кейс использования** функции
- **Предлагаемое решение**
- **Альтернативы**, которые рассматривали

## Настройка окружения

### Требования

- Node.js 20+
- Docker и Docker Compose
- Git

### Локальная установка

```bash
# Клонировать форк
git clone https://github.com/YOUR_USERNAME/payment-gateway.git
cd payment-gateway

# Добавить upstream
git remote add upstream https://github.com/ORIGINAL_OWNER/payment-gateway.git

# Установить зависимости
npm install

# Запустить инфраструктуру
docker-compose up -d

# Запустить миграции
npm run migrate

# Запустить сервер разработки
npm run dev
```

### Запуск тестов

```bash
# Все тесты
npm test

# С покрытием
npm run test:coverage

# Конкретный файл
npm test -- tests/unit/crypto.test.ts

# Watch режим
npm run test:watch
```

## Внесение изменений

### Именование веток

- `feature/добавить-нового-провайдера` — новые функции
- `fix/валидация-платежа` — исправление багов
- `docs/обновить-readme` — документация
- `refactor/упростить-saga` — рефакторинг
- `test/добавить-тесты-вебхуков` — тесты

### Сообщения коммитов

Следуйте [Conventional Commits](https://www.conventionalcommits.org/):

```
тип(область): описание

[опционально тело]

[опционально footer]
```

Типы:
- `feat`: Новая функция
- `fix`: Исправление бага
- `docs`: Документация
- `style`: Форматирование
- `refactor`: Рефакторинг
- `test`: Тесты
- `chore`: Обслуживание

Примеры:
```
feat(payments): добавить поддержку PayPal

fix(idempotency): исправить обработку параллельных запросов

docs(readme): обновить инструкцию установки

test(refunds): добавить тесты частичных возвратов
```

### Процесс изменений

1. **Создать ветку** от `main`
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feature/ваша-функция
   ```

2. **Внести изменения**
   - Пишите чистый, читаемый код
   - Добавьте тесты для новой функциональности
   - Обновите документацию при необходимости

3. **Проверить изменения**
   ```bash
   npm test
   npm run lint
   ```

4. **Закоммитить**
   ```bash
   git add .
   git commit -m "feat(scope): описание"
   ```

## Отправка изменений

### Pull Request

1. **Обновить ветку**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Запушить**
   ```bash
   git push origin feature/ваша-функция
   ```

3. **Создать Pull Request**
   - Используйте понятный заголовок
   - Укажите связанные issues (`Fixes #123`)
   - Опишите изменения

4. **Ответить на ревью**
   - Ответьте на все комментарии
   - Запушьте исправления
   - Запросите повторное ревью

### Чеклист PR

- [ ] Тесты проходят локально
- [ ] Линтер проходит
- [ ] Новый код покрыт тестами
- [ ] Документация обновлена
- [ ] Коммиты следуют конвенции
- [ ] Ветка актуальна с main

## Стандарты кода

### TypeScript

- Используйте strict mode
- Предпочитайте `interface` для объектов
- Указывайте типы возвращаемых значений
- Избегайте `any` — используйте `unknown`

```typescript
// Хорошо
interface PaymentRequest {
  amount: number;
  currency: string;
}

function processPayment(request: PaymentRequest): Promise<PaymentResult> {
  // ...
}

// Плохо
function processPayment(request: any): any {
  // ...
}
```

### Стиль кода

- 2 пробела для отступов
- Одинарные кавычки для строк
- Trailing commas
- Максимум 100 символов в строке

### Организация файлов

```typescript
// 1. Импорты (внешние, затем внутренние)
import { FastifyInstance } from 'fastify';
import { paymentService } from '../services/payment.service.js';

// 2. Типы/Интерфейсы
interface RouteOptions {
  prefix: string;
}

// 3. Константы
const MAX_AMOUNT = 1000000;

// 4. Основные экспорты
export async function paymentRoutes(fastify: FastifyInstance) {
  // ...
}

// 5. Вспомогательные функции
function validateAmount(amount: number): boolean {
  // ...
}
```

### Обработка ошибок

- Используйте кастомные классы ошибок
- Включайте коды ошибок для API
- Логируйте ошибки с контекстом

```typescript
// Определение ошибки
class PaymentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

// Использование
throw new PaymentError('Неверная сумма', 'INVALID_AMOUNT', 400);
```

## Тестирование

### Структура тестов

```typescript
describe('PaymentService', () => {
  describe('createPayment', () => {
    it('должен создать платёж с валидными данными', async () => {
      // Подготовка
      const request = { amount: 100, currency: 'USD' };

      // Действие
      const result = await paymentService.createPayment(request);

      // Проверка
      expect(result.status).toBe('completed');
    });

    it('должен отклонить отрицательную сумму', async () => {
      // ...
    });
  });
});
```

### Рекомендации

- Тестируйте поведение, не реализацию
- Используйте понятные названия тестов
- Следуйте паттерну Arrange-Act-Assert
- Мокайте внешние зависимости
- Стремитесь к покрытию 80%+

