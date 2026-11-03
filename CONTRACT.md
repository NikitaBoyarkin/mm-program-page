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
| `src/components/Nav.astro` | view | шапка, drawer, дни, тумблер темы (луна в разметке), счётчик избранного |
| `src/components/ProgramPage.astro` | view | день: шапка, табы, чипы, тулбар, сетка, модалка |
| `src/components/TalkCard.astro` | view | карточка доклада; звезда избранного (контур → заливка через `fill-opacity`) |
| `src/components/TalkModal.astro` | view | оболочка диалога |
| `src/pages/index.astro`, `src/pages/day/[n].astro` | view | три пререндеренных дня |
| `src/pages/program.json.ts` | data | `/program.json` — тот же слепок для клиента |
| `src/scripts/program-client.ts` | client | единственный JS: тема (морф иконки), drawer, фильтр, избранное, модалка, `.ics` |
| `src/styles/tokens.css` | design | токены трёх тем + шрифты + типографическая шкала (заморожено) |
| `src/styles/site.css` | design | каркас страницы |
| `src/styles/program.css` | design | сетка, карточка, модалка, печать |
| `tests/lib/*.test.ts` | verify | юнит-тесты ядра (`bun test`) |
| `tests/built/program.spec.ts` | verify | 27 браузерных тестов сборки (Playwright) в трёх проектах — 81 прогон |
| `package.json`, `bun.lock` | deps | версии сборки; `morphicons` запинен на `1.7.0` — иконки тем |

Иконка темы живёт в двух видах: луна в разметке (`.astro` не знает о `localStorage`) и
`d` текущей темы, который клиент ставит через `morphicons` (`THEME_ICON` в
`program-client.ts`). Править один вид без другого — расхождение с контрактом.

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

Шапка и меню: `header.nav-mobile > div.nav-top-actions` с
`button.nav-icon-btn.theme-toggle--header[data-theme-toggle]` (тема из шапки, без меню) и
`button.nav-toggle[data-nav-open][aria-expanded][aria-controls=site-nav]`; второй
`button.theme-toggle[data-theme-toggle]` и `[data-favorites-count]` живут в `.drawer-foot`
внутри `nav#site-nav`, где также `ul.drawer-links > a.drawer-link.is-current`. Оба тумблера
темы несут `data-theme-toggle` и обрабатываются делегированным слушателем. Ещё:
`div.nav-scrim[data-nav-close]`, `body.nav-open`.

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
| `.track-chip`, `.talk-card__title-btn` | `min-block-size: 44px` — сенсорная цель, а не только визуальная высота; подписи не мельче 0.75 rem |
| `.talk-card__favorite`, `.talk-card__toggle-btn`, `.talk-modal__close` | целевой размер 44 px даёт псевдоэлемент (`::after`/`::before`), глиф остаётся прежнего размера |
| `header.nav-mobile` | `backdrop-filter: none`: блюр на каждой прокрутке дороже, чем даёт, а фон `color-mix(… 97%)` и так почти непрозрачен |
| `nav.day-tabs` | липкие под шапкой, `flex-wrap: nowrap`; подпись вкладки без даты (`.day-tab__date` скрыт), поэтому три вкладки встают в строку даже на 320 px. Горизонтальный скролл остаётся страховкой, а не основным способом добраться до третьего дня |

Липкая цепочка сверху вниз: `header.nav-mobile` → `nav.day-tabs` →
`.program-grid__time-cell`. Смещение каждой ступени — сумма высот предыдущих
(токены `--nav-mobile-h` и `--mm-day-tabs-h`); разделитель не заезжает под табы дня.

Кнопка закрытия модалки — `position: sticky` внутри `div.talk-modal__dialog`, `inset-block-start: 0`
(не `var(--space-3)`: 12 px складывались с 16 px паддинга и вешали кнопку в 29 px от края) и
`flex: none` (иначе flex-сжимание режет цель до 22 px на длинном докладе): она остаётся
у верхнего края при любой глубине прокрутки длинного описания. Дерево разметки не менялось,
`button.talk-modal__close[data-modal-close]` остаётся прямым ребёнком диалога.


## Поведение (`src/scripts/program-client.ts`)

1. **Тема**: `dark → light → cyberpunk → dark`, `localStorage['theme']`, обновление
   `meta[name=theme-color]`. До первой отрисовки ту же работу делает inline-скрипт в `<head>`.
2. **Drawer**: `body.nav-open`, `aria-expanded`, закрытие по `Esc`, scrim'у и ссылке, возврат
   фокуса на триггер. Тумблер меню виден на всех ширинах: drawer остаётся единственным путём
   к дням. Тема — уже нет: второй тумблер живёт в шапке и работает без открытия меню.
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
   `[data-modal-dialog]`, возврат фокуса на триггер. Слой живёт в истории браузера: открытие
   делает `pushState` с маркером `mmLayerToken`, системная «Назад» (`popstate`) закрывает
   модалку и не уводит со страницы, а пользовательское закрытие вызывает `history.back()` —
   только если верхняя запись ещё наша, иначе `back()` выкинул бы со страницы. Тот же
   механизм у drawer'а: обе панели открываются через `pushLayer`, а закрываются своими
   `closeDrawer`/`closeModal` с общей проверкой `mmLayerToken`.
9. **`.ics`**: экспортирует видимые доклады дня (с учётом фильтра) через `buildCalendar`
   и `downloadIcs`; имя файла `matemarketing-<YYYY-MM-DD>.ics`; пустой набор → тост.
10. **Тост**: `div.mm-toast[role=status]`, живёт ~2.5 с.

## Доступность и качество

- Интерактив — только `button`/`a`; никаких `div` с обработчиком и `href="#"`.
- Счётчик докладов — `p.talk-count[aria-live=polite]`: фильтр переписывает число и слово,
  и скринридер слышит новое значение, не теряя фокуса.
- Пока модалка открыта, весь фон получает `inert` (плюс `aria-hidden` как фолбэк без
  поддержки `inert`); ставит и снимает его `MutationObserver` в `TalkModal.astro`.
- Табы дней — ссылки с `aria-current`; чипы — `button` с `aria-pressed`; карточка открывается
  кнопкой заголовка (не `tabindex` на `article`).
- Фокус-видимый на всём интерактиве; `:focus-visible` объявлен в токенах.
- `prefers-reduced-motion: reduce` снимает переходы; `@media print` даёт белый лист без
  баннеров и навигации.
- Тексты из данных — только `textContent`/`createElement`; `innerHTML` в клиенте не используется.
- Консоль чистая: ни одного `console.error`/`pageerror` на `/` и `/day/2/` (тест `04`).
- Без JavaScript страница читается целиком: сетка, табы, чипы, счётчик (тест `13`).
- Декоративный `:hover` живёт только под `@media (hover: hover) and (pointer: fine)`;
  на сенсорных экранах отклик дают явные `:active`-состояния. Обёртка `@media` не меняет
  селекторный контракт выше, но декларации в этой волне менялись: крестик модалки переведён
  с `absolute` на `sticky` (см. мобильную модель), у него появился `flex: none`, а сенсорные
  цели выросли до 44 px через псевдоэлементы.
- `-webkit-tap-highlight-color: transparent` на `html` и `touch-action: manipulation` на
  интерактиве: без серой вспышки на Android и без двойного тап-зума на iOS.

## Типографика

- Шкала прозы повторяет `.prose` портфолио: `--prose-measure: 66ch`,
  `--prose-lh: 1.5`, `--prose-indent: 1.5em` — в `tokens.css`, рядом с `--text-body`.
- Единственная длинная проза — описание доклада в модалке: `.talk-modal__text`
  ограничен мерой, абзац открывается красной строкой, а межабзацная маржа —
  волосок `0.25em` (её хватает отделить абзац от следующего блока, и она не
  спорит с отступом), выключка `justify` с `hyphens: auto`, перенос слова —
  `overflow-wrap: break-word`, а `text-wrap: pretty` из глобального правила `p`
  сброшен в `wrap`: `pretty` перебрасывает слово вниз ради последних строк, и
  выключка растягивает остаток — замер дал промежутки 4.1× нормы. На 640 px и уже красная строка снимается и
  выключка возвращается к левому краю: на узкой колонке промежутки между
  словами перевешивают ровный правый край.
- Ссылки: глобальное правило `a` рисует `text-decoration` (не `border-bottom`),
  цвет линии — половина `--text-accent` через `color-mix`,
  `text-underline-offset: 0.18em`, на hover линия становится `currentColor`.
  Контраст линии к фону — 2.28:1 в светлой теме и 1.83:1 в тёмной: это паритет
  с портфолио, а читаемость ссылки держит сам цвет текста (5.72:1 и 4.85:1).
  UI-ссылки (чипы, карточки, кнопки) гасят подчёркивание своими правилами:
  восемь `text-decoration: none` в `site.css` и `program.css`, девятый —
  у `.skip-link` в `tokens.css`.
  Переходы гасит общий `prefers-reduced-motion` в конце `tokens.css`.
- Заголовки остаются дисплейным Cormorant: это записанное отклонение
  дизайн-системы (см. `docs/DECISIONS.md`), а не проза.

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
