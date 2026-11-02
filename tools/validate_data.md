# Данные программы

API: `https://lms.matemarketing.ru/api/event-program/event/6/` — публичный Django REST
без авторизации. Ответ (~335 КБ) лежит в `data/program.raw.json`, из него собирается
`data/program.js` (`window.MM_PROGRAM`) — источник данных для `assets/app.js`.

```bash
python3 tools/fetch_program.py --fetch    # скачать payload и пересобрать program.js
python3 tools/fetch_program.py --check    # OK или diff, exit 1 при дрейфе
python3 tools/fetch_program.py --dry-run  # счётчики, без записи
python3 tests/test_data.py                # контракт; --file /tmp/x.js — копия
```

`--fetch` шлёт `User-Agent: mm-program-page/1.0` (timeout 30 c) и пишет файлы только
после успешного разбора: при сетевой ошибке — код 1, коммитнутые файлы не тронуты.
`--check` игнорирует `generatedAt` и пробельные различия, поэтому проходит на
закоммиченном состоянии; при дрейфе печатает первые 40 строк unified diff.
Пересборка из уже скачанного — `python3 tools/fetch_program.py`.

Ловушка: в API описания приходят как HTML (`<p>`, `<br />`, `<li>`, `&nbsp;`),
генератор разворачивает их в plain text; `short_description` иногда пуст и падает
обратно на первый абзац `description`, а если пусто и там — остаётся `""`.
