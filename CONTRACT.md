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
| `src/lib/analytics.ts` | core | UTM-атрибуция и единственный канал в PostHog (`track`, супер-свойства) |
| `src/components/Analytics.astro` | view | ленивый `init` PostHog, `outbound_click` |
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
  div.track-chips[data-track-chips]
    button.track-chip[data-fav-filter][aria-pressed]        ← всегда первый чип, без data-track
    button.track-chip[data-track][aria-pressed] × N          ← чипы треков из чипов
  p.talk-count > span[data-talk-count] + span[data-talk-count-label]
  button.button[data-export-ics]
section.program-grid[data-grid][style=--mm-hall-count:N]
  div.program-grid__halls-header > div.program-grid__time-label + div.program-grid__hall-name × N
  div.program-grid__content
    div.program-grid__time-cell[style="grid-area:R / 1"]
    div.program-grid__talk-cell[data-track][data-span][style="grid-area:R / C / span N"]
      article.talk-card[data-talk-id][data-track]
        div.talk-card__top
          div.talk-card__header > span.talk-card__time + span.talk-card__hall + button.talk-card__favorite[data-fav][data-talk-id][aria-pressed]
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

## Мобильная модель (≤ 767.98 px)

Мобильный вид — не сжатая сетка, а **хронологический список**. Модель переключается
только CSS: разметка одна, и DOM уже идёт в порядке строк (время → доклады строки по
залам → следующее время), поэтому `display: flex` на контенте даёт список бесплатно,
а inline `grid-area` в не-grid контейнере игнорируется. Второго HTML, второго маршрута
и второй копии карточек нет; без JS список читается целиком (тест `13`).

| Селектор | ≤ 767.98 px |
| --- | --- |
| `.program-grid` | `overflow-x: visible`, без `min-inline-size` — горизонтального скролла нет вовсе |
| `.program-grid__halls-header` | `display: none` — зал показан бейджем в карточке |
| `.program-grid__content` | `display: flex; flex-direction: column` — строки сетки исчезают |
| `.program-grid__time-cell` | липкий разделитель группы времени, а не колонка |
| `.program-grid__talk-cell` | блок во всю ширину, паддинг сетки снят |
| `article.talk-card` | `block-size: auto`: карточка по контенту, минимум строки 460 px не действует |
| `.talk-card__media` у карточки **с** баннером | скрыт целиком |
| `.talk-card__media` у `.talk-card--compact` | остаётся: в нём живёт `h3` с кнопкой заголовка |
| `.talk-card__time` | скрыт — время несёт разделитель |
| `.talk-card__hall` | виден только здесь; на десктопе `display: none` |
| `nav.day-tabs` | липкие под шапкой, `flex-wrap: nowrap` + горизонтальный скролл |

Липкая цепочка сверху вниз: `header.nav-mobile` → `nav.day-tabs` →
`.program-grid__time-cell`. Смещение каждой ступени — сумма высот предыдущих
(токены `--nav-mobile-h` и `--mm-day-tabs-h`); разделитель не заезжает под табы дня.


## Поведение (`src/scripts/program-client.ts`)

1. **Тема**: `dark → light → cyberpunk → dark`, `localStorage['theme']`, обновление
   `meta[name=theme-color]`. До первой отрисовки ту же работу делает inline-скрипт в `<head>`.
2. **Drawer**: `body.nav-open`, `aria-expanded`, закрытие по `Esc`, scrim'у и ссылке, возврат
   фокуса на триггер. Тумблер меню виден на всех ширинах: drawer — единственный путь к дням
   и теме.
3. **День**: обычная ссылка (`/`, `/day/2/`, `/day/3/`); `aria-current="page"` у активного.
   Клиент день не переключает.
4. **Фильтр**: один активный чип трека (`aria-pressed`), ячейки чужого трека получают
   `hidden`, пустые ячейки остаются, счётчик и подпись пересчитываются, состояние живёт
   в `?track=` (`history.replaceState`), при 0 докладов показывается `[data-empty]`.
   Второй, независимый переключатель — «Избранное»: `button.track-chip[data-fav-filter]`,
   первый в `.track-chips`, **без `data-track`**, поэтому селектор чипов трека
   (`[data-track-chips] > button.track-chip[data-track]`) его не подхватывает.
   Условия складываются по «И»: видима ячейка, у которой (трек не выбран или совпал)
   И (избранное выключено или доклад в избранном); в URL попадает только `?track=`.
   Число в чипе — размер избранного, обновляется вместе с `[data-favorites-count]`;
   снятие звезды при включённом фильтре немедленно убирает карточку из списка.
   В режиме списка (≤767.98 px) у группы не остаётся видимых докладов → её
   `.program-grid__time-cell` тоже получает `hidden` (липкий заголовок без содержимого —
   мусор). В режиме сетки разделители времени не скрываются: иначе рвётся колонка времени.
   Текст `[data-empty]` различается: пусто из-за фильтра избранного — «В избранном пока нет
   докладов этого дня», пусто из-за трека — прежняя формулировка.
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

## Аналитика

- Схема совпадает с портфолио: `visit_utm_*` (кампания текущего визита), `first_utm_*`
  (первый заход), `initial_referrer_class`, `landing_path` — и `site: "mm-program-page"`,
  по которому тайлы отличают этот сайт от портфолио в общем проекте PostHog.
- Все свойства — супер-свойства, а не свойства `$pageview`: клик по билету обязан нести кампанию тоже.
- SDK грузится только после первого взаимодействия и никогда на `localhost`/`127.0.0.1`.
- Без `PUBLIC_POSTHOG_KEY` скрипт не рендерится; сборка и страница работают как раньше.
- Единственное событие, которое сайт шлёт сам, — `outbound_click {domain, url, surface, path}`
  на внешние ссылки (билеты Матемаркетинга, первоисточник, портфолио). Остальное — автозахват.

## Отклонения от оригинала

Фиксируются в `README.md` и `docs/DECISIONS.md`: палитра и шрифты дизайн-системы портфолио,
шапка вместо левой app-панели, день как URL, баннер на всю ширину карточки и более высокая
строка сетки. Нет авторизации, кабинета, чата, плеера и оплаты. Медиа — hotlink с CDN
первоисточника. Счётчик — доклады, не «онлайн».
