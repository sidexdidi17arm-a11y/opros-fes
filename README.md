# Статистика опроса по ФЭС — Render + PostgreSQL

Этот проект **НЕ меняет верстку/логику шаблона**: UI остаётся тем же, что в исходном HTML, но вместо чистого `localStorage` данные **синхронизируются с сервером** и сохраняются в PostgreSQL.

Исходный шаблон: см. приложенный HTML-файл. fileciteturn1file0

## Структура проекта

```
.
├─ public/
│  ├─ index.html
│  └─ assets/
│     ├─ css/style.css
│     └─ js/app.js
├─ server/
│  └─ db.js
├─ server.js
├─ package.json
└─ .gitignore
```

## Переменные окружения

На Render нужно задать:

- `DATABASE_URL` — строка подключения к Postgres (НЕ коммитьте в репозиторий!)
- (Render сам задаёт) `PORT`

### Ваш адрес БД (как вы дали)

**Важно:** сохраните это как переменную окружения `DATABASE_URL` в Render:

```
postgresql://opros_user:6Z0ZwUojKtaVL41cxF7mW7YmXgsH9aU2@dpg-d64sigi4d50c73eno980-a/opros
```

## Локальный запуск (для проверки)

1) Установить зависимости:

```bash
npm install
```

2) Запуск:

```bash
npm start
```

Откройте: http://localhost:3000

## Деплой на Render (Web Service)

1) Загрузите этот проект в GitHub (или GitLab).

2) В Render:
- **New +** → **Web Service**
- Подключите репозиторий
- Runtime: **Node**
- Build Command: `npm install`
- Start Command: `npm start`

3) Environment:
- Добавьте `DATABASE_URL` (строку выше)

4) Deploy.

После деплоя:
- сайт доступен по URL Render
- API проверка: `/api/health`
- данные: `/api/weeks`

## Как работает сохранение

- UI сохраняет данные как раньше, но:
  - пишет резервную копию в `localStorage`
  - делает `PUT /api/weeks` и сохраняет массив недель в PostgreSQL
- при открытии:
  - сначала грузит с сервера `GET /api/weeks`
  - если сервер недоступен — берёт из `localStorage`

## Примечания по безопасности

- Не храните пароль БД в коде/репозитории.
- Меняйте пароль администратора в UI при необходимости (в `public/assets/js/app.js`, блок `AppConfig.USERS.admin.passwordHash`).

