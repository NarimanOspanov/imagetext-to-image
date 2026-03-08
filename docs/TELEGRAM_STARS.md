# Telegram Stars — включение оплаты в боте

## Что уже сделано в коде

- Оплата через **Telegram Stars** (валюта `XTR`) реализована: создание счёта (`sendInvoice`), подтверждение (`pre_checkout_query`), зачисление (`successful_payment`).
- Для цифровых товаров **provider_token** не нужен — передаётся пустая строка `''`.

## Как включить оплату звёздами

### 1. Ничего дополнительно в BotFather делать не нужно

Для оплаты **цифровых товаров и услуг** звёздами (XTR) отдельно «включать» платёж в BotFather **не требуется**. Достаточно обычного бота и корректного вызова API:

- `sendInvoice` с `currency: "XTR"` и `provider_token: ""`
- Обработка `pre_checkout_query` и `successful_payment`

Токен платёжного провайдера (Stripe, ЮKassa и т.п.) нужен только для **физических товаров**. Для звёзд его нет.

### 2. Тестовое окружение (рекомендуется для проверки)

Чтобы тестировать оплату без реальных звёзд:

1. Откройте [@BotFather](https://t.me/BotFather).
2. Выберите бота: `/mybots` → ваш бот.
3. **Bot Settings** → **Payments** → при необходимости настройки только для физических товаров; для Stars это не обязательно.
4. Для тестов используйте **тестовое окружение Telegram**:  
   [Testing your bot](https://core.telegram.org/bots/features#testing-your-bot) — там можно создавать счета и проверять поток оплаты.

### 3. Если счёт не создаётся: типичные причины

- **Неверный формат вызова**  
  В Telegraf нужно передавать один объект `invoice` во второй аргумент `sendInvoice(chatId, invoice)` с полями:  
  `title`, `description`, `payload`, `provider_token`, `currency`, `prices`.  
  Для Stars: `provider_token: ''`, `currency: 'XTR'`.

- **Ошибка от API**  
  В логах и в ответе пользователю теперь выводится текст ошибки от Telegram (например, про длину `title`/`description` или `payload`). Проверьте:
  - `title`: 1–32 символа
  - `description`: 1–255 символов
  - `payload`: 1–128 байт

- **Регион/приложение**  
  В некоторых регионах или клиентах Stars могут быть недоступны. Убедитесь, что тестируете в поддерживаемом приложении и регионе.

### 4. Полезные ссылки

- [Bot Payments API for Digital Goods and Services (Stars)](https://core.telegram.org/bots/payments-stars)
- [Bot API: sendInvoice](https://core.telegram.org/bots/api#sendinvoice)
- [Testing your bot](https://core.telegram.org/bots/features#testing-your-bot)
