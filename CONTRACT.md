# CONTRACT — mm-program-page (v2, Astro)

Замороженный интерфейс. Правки вносятся только вместе с правкой этого файла: все части
проекта кодируют против него, а не против своих догадок.

## Что это

Программа конференции `https://lms.matemarketing.ru/events/all/6/program` (Матемаркетинг 2026),
собранная как Astro-проект: три пререндеренных дня, сетка «время × залы», карточки докладов,
фильтр по трекам, избранное, модалка, экспорт дня в `.ics`.

Статический вывод (`output: "static"`), без адаптера и без бэкенда. `bun run build` → `dist/`,
который живёт на любом статик-хостинге. `file://` не поддерживается: роутам и ассетам нужен
сервер (`bun run preview`).

## Файлы и владельцы

| Путь | Владелец | Назначение |
| --- | --- | --- |
| `src/data/program.json` | data | нормализованный слепок API — единственный источник данных |
| `data/program.raw.json` | data | сырой ответ API (вход пересборки) |
| `scripts/fetch-program.ts` | data | `--fetch` / `--check` / `--dry-run`, нормализация |
| `src/lib/program.ts` | core | типы + чистые функции домена (заморожено) |
| `src/lib/ics.ts` | core | сборка `.ics` (заморожено) |
| `src/lib/theme.ts` | core | три темы, цвета `theme-color`, `nextTheme` |
| `src/layouts/Base.astro` | view | `<head>`, тема до отрисовки, шапка, подвал |
| `src/components/Nav.astro` | view | шапка, drawer, дни, тумблер темы, счётчик избранного |
| `src/components/ProgramPage.astro` | view | день: шапка, табы, чипы, тулбар, сетка, модалка |
| `src/components/TalkCard.astro` | view | карточка доклада |
| `src/components/TalkModal.astro` | view | оболочка диалога |
| `src/pages/index.astro`, `src/pages/day/[n].astro` | view | три пререндеренных дня |
| `src/pages/program.json.ts` | data | `/program.json` — тот же слепок для клиента |
| `src/scripts/program-client.ts` | client | единственный JS: тема, drawer, фильтр, избранное, модалка, `.ics` |
| `src/styles/tokens.css` | design | токены трёх тем + шрифты (заморожено) |
| `src/styles/site.css` | design | каркас страницы |
| `src/styles/program.css` | design | сетка, карточка, модалка, печать |
| `tests/lib/*.test.ts` | verify | юнит-тесты ядра (`bun test`) |
| `tests/built/program.spec.ts` | verify | 15 браузерных тестов сборки (Playwright) |

## Данные: `src/data/program.json`

```jsonc
{
  "source": "https://lms.matemarketing.ru/api/event-program/event/6/",
  "generatedAt": "2026-11-02T20:22:10Z",
  "event": { "id": 6, "name": "Матемаркетинг 2026", "startDate": "2026-11-17", "endDate": "2026-11-27" },
  "halls": [{ "id": 43, "name": "Молекула", "order": 0 }],
  "tracks": [{ "id": 28, "name": "ТРАНСФОРМАЦИЯ", "description": "" }],
  "days": [{
    "id": 10, "date": "2026-11-26", "name": "1 день", "order": 0,
    "halls": ["Молекула", "Атом", "Архангельск", "Физика", "Кинетика"]
  }],
  "talks": [{
    "id": 267, "dayId": 10, "hall": "Молекула",
    "track": "ТРАНСФОРМАЦИЯ", "trackId": null,      // null у 27 докладов
    "title": "…", "start": "11:00", "end": "12:10", // "HH:MM", МСК
    "image": "https://… | null",                     // null у 13 докладов
    "lectors": [{ "name": "…", "role": "…", "photo": "https://… | null" }],
    "short": "…",                                    // текст карточки; "" только у id 362
    "description": "…",                              // полный текст; может быть ""
    "highlighted": false, "free": false, "broadcastType": "stream"
  }]
}
```

Правила нормализации: `short` = `short_description` → первый абзац `description` → `""`;
`lectors[].name` = имя + фамилия (+ отчество); `days[].halls` — залы с докладами в порядке
`hall.order`; тексты — плоский plain text (без тегов, сущностей и `null`-строк).

## Типы и функции ядра (`src/lib/program.ts`, `src/lib/ics.ts`)

`Program, Day, Talk, Hall, Track, Lector`; `PROGRAM`; `minutes, isTime, formatRange, days,
talksOfDay, hallsOfDay, tracksOfProgram, isPlaceable, startsOf, spanOf, placeTalks,
occupiedCells, pluralTalks, dayLabel, dayLongLabel, firstParagraph, resolveDay, dayByOrdinal,
resolveTrack, talkById, dayHref`. Календарь: `icsEscape, foldLine, icsDate, icsStamp,
buildCalendar, calendarFilename, downloadIcs`.

Правила, которые эти функции держат:

- Строка сетки = уникальное время начала доклада, по возрастанию.
- `span` = число строк, которые доклад перекрывает (`11:00–12:10` при строках 11:00, 11:40,
  12:10 → 2).
- Два доклада в одном зале на одно время → второй попадает в `collisions`, а не теряется.
- Доклад, начинающийся внутри чужого слота, укорачивает предыдущий: ни одна карточка
  не исчезает.
- Карточка, перекрывающая больше одной строки, получает `span N` в `grid-area`.

## Разметка: CSS ↔ JS ↔ view контракт

```
html[data-theme=dark|light|cyberpunk][data-day-id][data-day-date]
  body > a.skip-link + header.nav-mobile + div.nav-scrim + nav#site-nav + main#main.page + footer.site-footer
```

Шапка и меню: `button.nav-toggle[data-nav-open][aria-expanded][aria-controls=site-nav]`,
`nav#site-nav` с `ul.drawer-links > a.drawer-link.is-current`, `button[data-theme-toggle]`,
`[data-favorites-count]` в `.drawer-foot`, `div.nav-scrim[data-nav-close]`, `body.nav-open`.

Программа:

```
header.page-head > p.eyebrow + h1.page-title + p.page-intro + dl.facts
nav.day-tabs > a.day-tab[href][aria-current=page] > span.day-tab__num + span.day-tab__date
div.program-toolbar
  div.track-chips[data-track-chips] > button.track-chip[data-track][aria-pressed]
  p.talk-count > span[data-talk-count] + span[data-talk-count-label]
  button.button[data-export-ics]
section.program-grid[data-grid][style=--mm-hall-count:N]
  div.program-grid__halls-header > div.program-grid__time-label + div.program-grid__hall-name × N
  div.program-grid__content
    div.program-grid__time-cell[style="grid-area:R / 1"]
    div.program-grid__talk-cell[data-track][data-span][style="grid-area:R / C / span N"]
      article.talk-card[data-talk-id][data-track]
        div.talk-card__top
          div.talk-card__header > span.talk-card__time + button.talk-card__favorite[data-fav][data-talk-id][aria-pressed]
          div.talk-card__media > img.talk-card__banner-img | div.talk-card__media-text > h3 > button.talk-card__title-btn[data-talk-open]
        div.talk-card__bottom
          div.talk-card__speakers > div.talk-card__speaker > img.talk-card__speaker-photo | span.talk-card__speaker-initials + div.talk-card__speaker-info > span.talk-card__speaker-name + span.talk-card__speaker-desc
          div.talk-card__content > h3.talk-card__content-title > button.talk-card__title-btn + div.talk-card__theses > p + button.talk-card__toggle-btn[data-more][aria-expanded]
p.program-empty[data-empty][hidden]
div.talk-modal[data-modal][hidden]
  div.talk-modal__backdrop[data-modal-backdrop]
  div.talk-modal__dialog[role=dialog][aria-modal][aria-labelledby=talk-modal-title][data-modal-dialog][tabindex=-1]
    button.talk-modal__close[data-modal-close]
    div.talk-modal__media[data-modal-media]
    div.talk-modal__body > [data-modal-meta] + h2#talk-modal-title[data-modal-title] + [data-modal-speakers] + [data-modal-text] + a.talk-modal__buy + button[data-modal-fav]
div.mm-toast[role=status]
```

Колонки: `--mm-grid-cols: var(--mm-time-col) repeat(var(--mm-hall-count), minmax(var(--mm-hall-min), var(--mm-hall-max)))`.
Значения при 1440 px: время 100 px, зал 420 px → карточка 391 px. Уже 1280 px: 70 px / 310–390 px,
горизонтальный скролл внутри сетки, время и шапка залов sticky.

## Поведение (`src/scripts/program-client.ts`)

1. **Тема**: `dark → light → cyberpunk → dark`, `localStorage['theme']`, обновление
   `meta[name=theme-color]`. До первой отрисовки ту же работу делает inline-скрипт в `<head>`.
2. **Drawer**: `body.nav-open`, `aria-expanded`, закрытие по `Esc`, scrim'у и ссылке, возврат
   фокуса на триггер. Тумблер меню виден на всех ширинах: drawer — единственный путь к дням
   и теме.
3. **День**: обычная ссылка (`/`, `/day/2/`, `/day/3/`); `aria-current="page"` у активного.
   Клиент день не переключает.
4. **Фильтр**: один активный чип (`aria-pressed`), ячейки чужого трека получают `hidden`,
   пустые ячейки остаются, счётчик и подпись пересчитываются, состояние живёт в `?track=`
   (`history.replaceState`), при 0 докладов показывается `[data-empty]`.
5. **Счётчик**: число докладов дня (с учётом фильтра), подпись через `pluralTalks`
   (`доклад / доклада / докладов`). Не имитация «онлайна».
6. **Избранное**: `localStorage['mm-program:favorites']` (массив id), синхронизация звезды,
   `aria-pressed`, `[data-favorites-count]` (число, включая 0) и `[data-modal-fav]`.
7. **Карточка**: `button.talk-card__title-btn` открывает модалку; «Подробнее» разворачивает
   текст в карточке (`talk-card--expanded`, подпись «Свернуть», `aria-expanded`).
8. **Модалка**: `hidden` по умолчанию; открытие — `hidden = false`, `body.is-modal-open`,
   заполнение из `/program.json`; закрытие — backdrop, кнопка, `Esc`; фокус-трап внутри
   `[data-modal-dialog]`, возврат фокуса на триггер.
9. **`.ics`**: экспортирует видимые доклады дня (с учётом фильтра) через `buildCalendar`
   и `downloadIcs`; имя файла `matemarketing-<YYYY-MM-DD>.ics`; пустой набор → тост.
10. **Тост**: `div.mm-toast[role=status]`, живёт ~2.5 с.

## Доступность и качество

- Интерактив — только `button`/`a`; никаких `div` с обработчиком и `href="#"`.
- Табы дней — ссылки с `aria-current`; чипы — `button` с `aria-pressed`; карточка открывается
  кнопкой заголовка (не `tabindex` на `article`).
- Фокус-видимый на всём интерактиве; `:focus-visible` объявлен в токенах.
- `prefers-reduced-motion: reduce` снимает переходы; `@media print` даёт белый лист без
  баннеров и навигации.
- Тексты из данных — только `textContent`/`createElement`; `innerHTML` в клиенте не используется.
- Консоль чистая: ни одного `console.error`/`pageerror` на `/` и `/day/2/` (тест `04`).
- Без JavaScript страница читается целиком: сетка, табы, чипы, счётчик (тест `13`).

## Отклонения от оригинала

Фиксируются в `README.md` и `docs/DECISIONS.md`: палитра и шрифты дизайн-системы портфолио,
шапка вместо левой app-панели, день как URL, баннер на всю ширину карточки и более высокая
строка сетки. Нет авторизации, кабинета, чата, плеера и оплаты. Медиа — hotlink с CDN
первоисточника. Счётчик — доклады, не «онлайн».
