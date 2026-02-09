# ПУ ФЭС — Render + PostgreSQL (без изменения рабочего шаблона)

Этот проект разворачивает ваш **оригинальный HTML-шаблон (всё как было и работает)** и добавляет сохранение данных в PostgreSQL на Render.

## Как это работает
- Шаблон по-прежнему хранит данные в `localStorage` (как в оригинале).
- Дополнительно подключен слой синхронизации: `public/assets/js/sync.js`
  - При запуске пытается загрузить `weeks` из БД: `GET /api/weeks`
  - При каждом сохранении в `localStorage` отправляет данные в БД: `PUT /api/weeks`
  - При «Удалить все данные» очищает БД: `DELETE /api/weeks`
- Если API/БД недоступны — приложение продолжает работать через `localStorage` (без падений).

## Переменные окружения (Render)
Нужно добавить `DATABASE_URL` (PostgreSQL connection string).

## Команды Render
- Build: `npm install`
- Start: `npm start`

## Локальный запуск
```bash
npm install
npm start
```
Открыть: http://localhost:3000
