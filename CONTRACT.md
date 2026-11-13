# CONTRACT — mm-program-page (v2, Astro)

Замороженный интерфейс. Правки вносятся только вместе с правкой этого файла: все части
проекта кодируют против него, а не против своих догадок.

## Что это

Программа конференции `https://lms.matemarketing.ru/events/all/6/program` (Матемаркетинг 2026),
собранная как Astro-проект: три пререндеренных дня, сетка «время × залы», карточки докладов,
фильтр по трекам, избранное, модалка, экспорт дня в `.ics`. Две локали (RU/EN), клиентский
поиск по всем трём дням и граф докладов (`/talks/`) — вторая проекция той же программы:
треки, темы и связи между докладами на принципах Zettelkasten.

Статический вывод (`output: "static"`), без адаптера и без бэкенда. `bun run build` → `dist/`,
который живёт на любом статик-хостинге. `file://` не поддерживается: роутам и ассетам нужен
сервер (`bun run preview`).

## Файлы и владельцы

| Путь | Владелец | Назначение |
| --- | --- | --- |
| `src/data/program.json` | data | нормализованный слепок API — единственный источник данных |
| `src/data/socials.json` | data | overlay соцсетей лекторов: имя → `telegram/linkedin/youtube/site`. Отдельный файл: `data:fetch` пересобирает `program.json` побайтово и стёр бы поле. Ключ — полное имя из слепка (все 94 уникальны), значение — только подтверждённые `https`-ссылки |
| `src/lib/socials.ts` | core | сети и подписи — один источник для Astro-разметки и клиента. Геометрии иконок здесь нет: пути соцсетей живут в `src/styles/site.css` (`--social-*`), декоративные — в `src/styles/program.css` (`--icon-*`), оба как CSS-маски |
| `src/data/copy.ru.json` | data | overlay текста карточки (`short`) по id доклада — редакция по стайлгайду Доки. Отдельный файл по той же причине, что `socials.json`: `data:fetch` пересобирает `program.json` побайтово. Нет ключа или пустое значение — остаётся текст слепка |
| `src/i18n/ui.ts` | i18n | словарь оболочки RU/EN: шапка, табы, фильтры, модалка, поиск, подвал. `UiKey` выводится из русской ветки, поэтому пропуск в `en` — ошибка типов |
| `src/i18n/format.ts` | i18n | подписи дат и числительных по языкам; русская ветка побайтово совпадает с замороженным ядром |
| `src/i18n/paths.ts` | i18n | адреса от `BASE_URL` с префиксом языка: `/`, `/day/N/`, `/en/`, `/en/day/N/`, `/talks/`, `/en/talks/` |
| `src/data/program.en.json` | data | overlay перевода контента: `tracks`/`halls`/`days` + `talks` по id доклада. Отдельный файл: `data:fetch` пересобирает `program.json` побайтово и стёр бы переводы (та же причина, что у `socials.json`) |
| `src/lib/localize.ts` | core | overlay → `Talk`/`Program`: `localizeTalk` переводит только текстовые поля, `localizeProgram` — ещё `track/hall/day` |
| `src/lib/search.ts` | core | чистый поиск без DOM и `fetch`: нормализация, ранги, многословный режим (все слова важнее части), опечатки по Левенштейну только на пустой литеральной выдаче, дедупликация по id, лимит 12 |
| `src/components/SearchDialog.astro` | view | каркас диалога поиска: `data-search-*`, пустой список на билде |
| `src/pages/en/index.astro`, `src/pages/en/day/[n].astro` | view | английские дни: `/en/` и `/en/day/2..N/` |
| `src/pages/en/program.json.ts` | data | `/en/program.json` — тот же слепок с переведёнными на билде текстами |
| `data/program.raw.json` | data | сырой ответ API (вход пересборки) |
| `scripts/fetch-program.ts` | data | `--fetch` / `--check` / `--dry-run`, нормализация |
| `src/lib/program.ts` | core | типы + чистые функции домена; собирает `PROGRAM` из слепка и overlay'ев `socials.json` / `copy.ru.json` (заморожено) |
| `src/lib/ics.ts` | core | сборка `.ics` (заморожено) |
| `src/lib/icons.ts` | core | общие глифы: звезда и ярлык трека (один контур на карточку/шапку и на чип/шапку — потому что это одна функция) |
| `src/lib/images.ts` | core | доставка картинок: `bannerSources` (WebP-варианты 400/800 только у Netlify-хоста), `photoSources` / `photoMapEntry` (локальная аватарка из `photos.json` с фолбэком на оригинал). Только билд: в `/program.json` локальные пути не уезжают — модалка валидирует `photo` через `imageUrl()`, а тот относительный адрес отвергает |
| `src/data/photos.json` | data | производная карта «оригинал аватарки → `/media/lectors/<hash>.webp`»; производится `bun run photos`, коммитится (по ней читают карточка и эндпоинт) |
| `scripts/optimize-photos.ts` | data | `prebuild`: качает аватарки, режет до 144×144 WebP q72 в `public/media/lectors/` (каталог не коммитится), ошибка сети не валит сборку |
| `src/lib/theme.ts` | core | три темы, цвета `theme-color`, `nextTheme` |
| `src/lib/analytics.ts` | core | UTM-атрибуция и единственный канал в PostHog (`track`, супер-свойства) |
| `src/components/Analytics.astro` | view | ленивый `init` PostHog, `outbound_click` |
| `src/layouts/Base.astro` | view | `<head>`, тема до отрисовки, шапка, подвал; `og:image` — `src/assets/og/program-2026.png` (1200×630), пересборка `bun run og` |
| `src/components/Nav.astro` | view | шапка, drawer (дни, «Граф докладов», ссылки портфолио), тумблер темы (луна в разметке), звезда «Избранное» со счётчиком (первая в группе действий, только на страницах дня), кнопка поиска и переключатель `.nav-lang` |
| `src/components/ProgramPage.astro` | view | день: шапка, табы, чипы, тулбар, сетка, модалка |
| `src/components/TalksPage.astro` | view | граф: шапка, figure с SVG, заметки по трекам, хабы тем, подвал |
| `src/components/TalksGraph.astro` | view | SVG графа и пакер подписей: раскладка приходит готовой, интерактив — только ссылки-якоря |
| `src/lib/talks-graph.ts` | core | Zettelkasten-модель, точка входа: атомарные заметки, хабы, рёбра `трек ↔ тема`, связанные доклады, обратные индексы по треку и теме. Реэкспортирует три части ниже, поэтому потребителю достаточно одного импорта |
| `src/lib/talks-themes.ts` | core | словарь тем: стемы, классификатор текста, подписи RU/EN и короткие формы для кольца графа. Единственная часть модели, не знающая о докладах как об узлах |
| `src/lib/talks-model.ts` | core | типы модели (`TalkNote`, `HubNode`, `GraphEdge`, `TalksGraph`) и ключ хаба трека: нужны и сборщику, и раскладке |
| `src/lib/talks-layout.ts` | core | детерминированная раскладка колец: темы внутри, треки снаружи, заметки на дугах. На вход — готовый граф, на выходе — координаты |
| `src/components/TalkCard.astro` | view | карточка доклада; звезда избранного (контур → заливка через `fill-opacity`) |
| `src/components/TalkModal.astro` | view | оболочка диалога |
| `src/pages/index.astro`, `src/pages/day/[n].astro` | view | три пререндеренных дня |
| `src/pages/talks.astro`, `src/pages/en/talks.astro` | view | тонкие обёртки `TalksPage` для двух локалей |
| `src/pages/program.json.ts` | data | `/program.json` — тот же слепок для клиента |
| `src/scripts/program-client.ts` | client | единственный JS: тема (морф иконки), drawer, фильтр, избранное, модалка, `.ics`, поиск, `?talk=<id>` |
| `src/styles/tokens.css` | design | токены трёх тем + шрифты + типографическая шкала (заморожено) + три слоя земли: ramp (`body::before`), свечение (`.ground-bloom`), соты (`body::after`), рампа и свечение едут двумя орбитами |
| `src/styles/nav.css` | design | шапка и её меню: круг кнопок группы действий, звезда избранного, меню треков (триггер + панель 12 пунктов), переключатель языка. Глобальный файл, потому что правила были scoped в `Nav.astro`, а все селекторы и так из `.nav-*`/`.track-menu*`; вынесено, когда компонент перевалил за бюджет 20 КБ на файл |
| `src/styles/site.css` | design | каркас страницы, шапка, подвал с контактами; геометрия иконок соцсетей — маски `--social-*` (нужны и карточкам, и подвалу, в том числе на `404`); иконки ссылок шапки — маски `--nav-*`; монограмма в шапке — маска `--brand-logo`: шестиугольник фавикона с вырезанными «NB» (`fill-rule: evenodd`, глифы Inter 800 путями) |
| `src/styles/program.css` | design | сетка, карточка, модалка, печать; геометрия всех декоративных иконок — маски `--icon-*` |
| `src/styles/talks.css` | design | граф и заметки: SVG, списки заметок, хабы тем. Отдельный файл: страница не грузит сетку, карточки и модалку |
| `src/styles/search.css` | design | диалог поиска; файл глобальный, потому что результаты вставляет клиент уже после отрисовки и узлы `.search-result` не получают scope-атрибут Astro |
| `tests/lib/*.test.ts` | verify | 191 юнит-тест ядра, i18n, поиска, земли, картинок, графа и заметок (`bun test tests/lib`, 10 файлов) |
| `tests/built/program.spec.ts` | verify | 31 браузерный тест сборки (Playwright) |
| `tests/built/i18n-search.spec.ts` | verify | 8 тестов EN-маршрутов, переключателя языка и поиска |
| `tests/built/talks.spec.ts` | verify | 10 тестов графа: заметки и якоря, SVG на билде, хабы тем, вход в шапке на трёх ширинах (включая 768 px — иконка), EN-копия, скролл только внутри графа |
| `tests/built/talk-pages.spec.ts` | verify | 5 тестов заметки доклада: адрес и пара языков, факты, связанные ссылки резолвятся, EN-переключатель, вход из модалки; вместе 54 теста × 3 проекта = 162 прогона |
| `src/content.config.ts` | core | коллекции `talks` / `talks-en`: zod-схема фактов заметки, `.strict()` ловит опечатку в ключе |
| `src/content/talks/<id>.md`, `src/content/talks-en/<id>.md` | data | по заметке на доклад в каждой локали (91 + 91); frontmatter производится генератором, тело — seed из описания и ручная правка |
| `src/lib/talk-note.ts` | core | детерминированный frontmatter-форматер и разбор файла: один источник для генератора и тестов |
| `scripts/generate-talk-notes.ts` | data | seed / `--check` / `--dry-run`; тело существующего файла не перезаписывает никогда |
| `src/components/TalkNote.astro` | view | тело заметки доклада: факты из `PROGRAM`, спикеры, темы, «Связанные», слот из `.md` |
| `src/pages/talk/[id].astro`, `src/pages/en/talk/[id].astro` | view | `/talk/<id>/` и `/en/talk/<id>/` |
| `src/styles/talk.css` | design | типографика заметки; страница не грузит сетку и модалку |
| `package.json`, `bun.lock` | deps | версии сборки; `morphicons` запинен на `1.7.0` — иконки тем |

Иконка темы живёт в двух видах: луна в разметке (`.astro` не знает о `localStorage`) и
`d` текущей темы, который клиент берёт из `THEME_ICONS` (`src/lib/theme.ts`) и подставляет
через `morphicons`. Обе стороны читают один источник — `THEME_PATHS`/`THEME_ICONS` там же;
ту же карту разметка кладёт в `data-theme-icons` для инлайнового fallback'а. Править один
вид без другого — расхождение с контрактом.

Остальные иконки — декоративные и живут **только в CSS**: `::before` с data-URI маской
(`--icon-calendar`, `--icon-clock`, `--icon-mic`, `--icon-layers`, `--icon-pin`,
`--icon-star`/`--icon-star-filled`, `--icon-download`, `--icon-ticket`, `--icon-chevron`,
`--icon-tag`, `--icon-expand`). Разметка остаётся текстовой, поэтому селекторы Playwright и порядок узлов не
меняются. Точки: `dt` фактов (класс `facts__item--*`), `.day-tab` (скрыт ≤ 767.98 px — иначе
полоса табов переполняет 320 px), чипы избранного и треков (на телефоне вся полоса чипов
скрыта, а трек выбирается из меню в шапке — `div.track-menu`), экспорт `.ics`, бейджи времени и
зала, «Подробнее» (шеврон переворачивается по `aria-expanded`), мета-кейсы, «Купить» и
«Избранное» в модалке. Новая иконка = `--icon-*` + селектор в общем рецепте.

Кнопка-заголовок карточки (`button.talk-card__title-btn`) несёт иконку «развернуть»
(`--icon-expand`) на обеих кнопках-заголовках — и на карточке без баннера, и на
`.talk-card__content-title`; их десятки, поэтому иконка приглушена (`opacity: 0.65`)
и на печати скрыта.

Подвал сайта (`footer.site-footer` в `Base.astro`) открывается строкой контактов
`.site-footer__contacts > a.footer-contact.social-link--<telegram|github|linkedin>`:
иконка — та же маска `--social-*`, что у соцсетей лекторов, поэтому подвал не заводит
второй набор путей. Подпись — имя сети, ссылки открываются в новой вкладке.

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

Соцсети в слепок не входят: `lectors[]` остаётся трёхпольным, overlay-файл
`src/data/socials.json` мерджится в `PROGRAM` (`socialsOf`), поэтому `/program.json` отдаёт
лекторов уже с полем `socials: [{ network, url }]` в порядке `telegram → linkedin → youtube →
site`. Ссылка принимается только при подтверждённой личности (ФИО + компания/роль), иначе
спикер остаётся без иконок — покрытие намеренно частичное.

## Языки (i18n)

Локали — `ru` (по умолчанию) и `en`. Язык определяется маршрутом, а не настройкой браузера:
переключатель — обычная ссылка на тот же день в другом языке.

| Маршрут | Что отдаёт |
| --- | --- |
| `/`, `/day/N/` | страница дня на русском |
| `/en/`, `/en/day/N/` | та же страница на английском |
| `/talks/`, `/en/talks/` | граф докладов: темы, треки, заметки с обратными ссылками |
| `/program.json` | русский слепок для клиента |
| `/en/program.json` | тот же слепок с переведёнными текстами, собранный на билде |

- `<html lang="ru|en" data-lang="ru|en" …>`: `lang` — для скринридеров и поиска, `data-lang`
  читает клиент (`LANG` в `program-client.ts`), чтобы запросить свою версию JSON.
- `hreflang`: у каждой страницы дня, включая корень локали (`/` ↔ `/en/`),
  `<link rel="alternate" hreflang="ru|en">` и `hreflang="x-default"` → русская версия
  (первична). У графа пара приходит путём (`alternatePath` в `Base.astro`), потому что дня
  у него нет. У 404 нет ни дня, ни пары, поэтому атрибутов там нет.
- Оболочка (кнопки, табы, фильтры, подвал, поиск) — словарь `src/i18n/ui.ts`. Контент
  (заголовки, описания, роли) — overlay `src/data/program.en.json`: `tracks`, `halls`, `days`
  и `talks` по id доклада с полями `title/short/description/lectorRoles`. Файл отдельный,
  потому что `data:fetch` пересобирает `program.json` побайтово.
- `localizeTalk` переводит только текстовые поля (`title`, `short`, `description`,
  `lectors[].role`); `id`, `dayId`, `start`, `end`, `track`, `hall` остаются оригинальными.
  `localizeProgram` дополнительно переводит `track`, `hall`, `days[].name` и `days[].halls` —
  этот результат уходит в `/en/program.json`.
- **`data-track` в разметке всегда русский.** По нему фильтрует клиент и он же связывает
  карточку с чипом; переведённое значение сломало бы селектор
  `[data-track-chips] > button.track-chip[data-track]`. Подпись чипа переводится отдельно
  (`trackLabel`), текст на карточке — тоже.
- Переключатель `.nav-lang` — ссылка на тот же день другой локали (`switchLangHref`),
  подпись — код цели (`EN`/`RU`), `hreflang` и `lang` — целевой язык.
- Английские тексты докладов — **машинный перевод** (неофициальный). Это принятое
  ограничение, а не эталон: при расхождении исходный русский текст из `program.json` считается
  источником истины.

## Типы и функции ядра (`src/lib/program-core.ts`, `src/lib/program.ts`, `src/lib/ics.ts`)

Чистые типы и помощники живут в `src/lib/program-core.ts` — модуле без единого импорта
из `src/data/`, который тянет клиентский чанк. `src/lib/program.ts` держит слепок
`PROGRAM`, функции над ним и реэкспортирует ядро, поэтому старые импорты
`../lib/program` работают как раньше. `dayHref` — русифицированный алиас
`dayHrefFor("ru", n)`; в разметке используется `src/i18n/paths.ts`.

`Program, Day, Talk, Hall, Track, Lector`; `PROGRAM`; `minutes, isTime, formatRange, days,
talksOfDay, hallsOfDay, tracksOfProgram, isPlaceable, startsOf, spanOf, placeTalks,
occupiedCells, pluralTalks, dayLabel, dayLongLabel, firstParagraph, resolveDay, dayByOrdinal,
resolveTrack, talkById, dayHref, socialsOf`; медиа: `IMAGE_HOSTS, imageUrl` — белый список
трёх CDN, единственный путь картинки из данных в разметку, плюс `src/lib/images.ts`
(`bannerSources, photoSources, photoMapEntry, BANNER_SIZES`) — единственное место, где из
разрешённого URL делается уменьшенный вариант. Соцсети: `SOCIAL_NETWORKS, SOCIAL_LABELS,
SocialNetwork, SocialLink` из `src/lib/socials.ts`. Календарь: `icsEscape, foldLine, icsDate, icsStamp,
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
html[data-theme=dark|light|cyberpunk][data-lang=ru|en][data-day-id][data-day-date]
  body > div.ground-bloom[aria-hidden] + a.skip-link + header.nav-mobile + div.nav-scrim + nav#site-nav + main#main.page + footer.site-footer
```

`div.ground-bloom` — второй слой земли (`tokens.css`, `tests/lib/ground.test.ts`): стоит
первым ребёнком `body`, потому что все три декоративных слоя делят `z-index: −1` и порядок
отрисовки задаёт только порядок в дереве (ramp → свет → соты).

Шапка и меню: `header.nav-mobile > div.nav-top-actions` с
`button.nav-icon-btn.nav-fav[data-fav-header][aria-pressed]` (звезда + `[data-favorites-count]`;
только на страницах дня — на `404` фильтровать нечего), `div.nav-tracks > button.nav-icon-btn.nav-tracks__trigger[data-track-header][aria-expanded]
[aria-controls=track-menu][data-active]` + `div.track-menu#track-menu[data-track-menu][hidden]`
с 12 пунктами `button.track-menu__item[data-track-option][data-track][aria-pressed]`
(«Все треки» + 11 треков; только на страницах дня) — раскрывающийся фильтр трека, а не сброс:
`button.nav-icon-btn[data-search-open]
[aria-controls=search-dialog][aria-expanded]` (только на страницах дня),
`a.nav-icon-btn.nav-lang[href][hreflang][lang]` (переключатель языка, текст `EN`/`RU`),
`button.nav-icon-btn.theme-toggle--header[data-theme-toggle]` (тема из шапки, без меню) и
`button.nav-toggle[data-nav-open][aria-expanded][aria-controls=site-nav]`; второй
`button.theme-toggle[data-theme-toggle]`, `button.drawer-favs[data-fav-drawer]`
(внутри тоже `[data-favorites-count]`; только на страницах дня, иначе кнопка-фильтр мертва)
и второй `a.nav-lang` живут в `.drawer-foot` внутри `nav#site-nav`, где также
`ul.drawer-links > a.drawer-link`; класс-модификатор `drawer-link--day|home|projects|contacts|talks`
даёт пункту иконку маской (`::before`). «Граф докладов» — **пункт этого сайта, а не ссылка
портфолио**, и живёт на трёх поверхностях, ни на одной не дублируясь:
`header.nav-mobile ul.nav-inline > li > a.nav-link--talks[href][aria-current=page]` (≥ 1024 px,
иконка `--nav-talks`), `header.nav-mobile div.nav-top-actions > a.nav-icon-btn.nav-graph`
(480–1023.98 px, `aria-current=page`) и `a.drawer-link.drawer-link--talks` в панели (всегда).
Ниже 480 px кнопки нет: пять целей по 44 px занимают 285 px из 296 возможных на 320 px.
Оба тумблера темы несут `data-theme-toggle` и обрабатываются делегированным слушателем.
Ещё: `div.nav-scrim[data-nav-close]`, `body.nav-open`.

Программа:

```
header.page-head > p.eyebrow + h1.page-title + p.page-intro
  dl.facts > div.facts__item.facts__item--<duration|talks|tracks|halls> > dt + dd
nav.day-tabs > a.day-tab[href][aria-current=page] > span.day-tab__num + span.day-tab__date
div.program-toolbar
  div.track-chips[data-track-chips]                        ← ≤ 767.98 px скрыт целиком (display: none)
    button.track-chip[data-fav-filter][aria-pressed]        ← всегда первый чип, без data-track
    button.track-chip[data-track][aria-pressed] × N          ← чипы треков; они же список
                                                               допустимых значений для клиента
  p.talk-count > span[data-talk-count] + span[data-talk-count-label]
  button.button[data-export-ics]
section.program-grid[data-grid][style=--mm-hall-count:N]
  div.program-grid__halls-header > div.program-grid__time-label + div.program-grid__hall-name × N
  div.program-grid__content
    div.program-grid__time-cell[style="grid-area:R / 1"]
    div.program-grid__talk-cell#t<id>[data-track][data-span][style="grid-area:R / C / span N"]
      article.talk-card[data-talk-id][data-track]
        div.talk-card__top
          div.talk-card__header > span.talk-card__time + span.talk-card__hall + span.talk-card__track + button.talk-card__favorite[data-fav][data-talk-id][aria-pressed]
          div.talk-card__media > img.talk-card__banner-img | div.talk-card__media-text > h3 > button.talk-card__title-btn[data-talk-open]
        div.talk-card__bottom
          div.talk-card__speakers > div.talk-card__speaker > img.talk-card__speaker-photo | span.talk-card__speaker-initials + div.talk-card__speaker-info > span.talk-card__speaker-name + span.talk-card__speaker-desc + span.social-links > a.social-link.social-link--<network>[href^=https][target=_blank][rel="noopener noreferrer nofollow"][aria-label]
          div.talk-card__content > h3.talk-card__content-title > button.talk-card__title-btn + div.talk-card__theses > p + button.talk-card__toggle-btn[data-more][aria-expanded] + p.talk-card__related > span.talk-card__related-label + a.talk-card__related-link[href] × 1..3
p.program-empty[data-empty][hidden]
div.talk-modal[data-modal][hidden]
  div.talk-modal__backdrop[data-modal-backdrop]
  div.talk-modal__dialog[role=dialog][aria-modal][aria-labelledby=talk-modal-title][data-modal-dialog][tabindex=-1]
    button.talk-modal__close[data-modal-close]
    div.talk-modal__media[data-modal-media]
    div.talk-modal__body > [data-modal-meta] + h2#talk-modal-title[data-modal-title] + [data-modal-speakers] + [data-modal-text] + a.talk-modal__buy + button[data-modal-fav]
div.mm-toast[role=status]
div.search-dialog[data-search-dialog][hidden]
  div.search-dialog__backdrop[data-search-close]
  div.search-dialog__panel[role=dialog][aria-modal=true][aria-labelledby=search-title][data-search-panel][tabindex=-1]
    h2#search-title.visually-hidden
    form.search-form[role=search][data-search-form]
      input.search-input[type=search][data-search-input][autocomplete=off]
      button.search-close[type=button][data-search-close][aria-label]
    p.search-hint[data-search-hint]
    ul.search-results[data-search-results][role=list]
    p.search-empty[data-search-empty][hidden]
    p.search-status.visually-hidden[data-search-status][role=status][aria-live=polite]
```

Результат поиска клиент создаёт как `li > a.search-result[href] >
span.search-result__day + span.search-result__title + span.search-result__meta`; `href` —
страница дня доклада (`dayHrefFor`) с `?talk=<id>`. Пустой список на билде: доклады
подставляет клиент после загрузки `/program.json`, иначе каждый день тащил бы всю программу
в HTML. `?talk=<id>` открывает модалку этого доклада при загрузке страницы (`initDeepLink`).

`[data-modal-speakers]` клиент заполняет строками `div.talk-modal__speaker` (фото/инициалы + имя +
роль + тот же `span.social-links > a.social-link`, что и в карточке). Пустой `socials` не рендерит
обёртку — разметка спикера без ссылок не меняется.

Колонки: `--mm-grid-cols: var(--mm-time-col) repeat(var(--mm-hall-count), minmax(var(--mm-hall-min), var(--mm-hall-max)))`.
Значения при 1440 px: время 100 px, зал 420 px → карточка 391 px. Уже 1280 px: 70 px / 310–390 px,
горизонтальный скролл внутри сетки, время и шапка залов sticky.

## Граф докладов (`/talks/`, `/en/talks/`)

Вторая проекция той же программы: не «время × залы», а «трек ↔ тема ↔ доклад». Страница
собрана на принципах Zettelkasten, и это не метафора, а четыре проверяемых свойства модели
(`src/lib/talks-graph.ts`):

1. **Атомарность.** Единица — один доклад. У него постоянный ключ `t<id>`: он же `id`
   ячейки на странице дня (`#t309`), он же якорь заметки на странице графа, он же параметр
   `?talk=309` у модалки. Один идентификатор на одну сущность.
2. **Связи вместо иерархии.** Ребро `трек ↔ тема` весит столько докладов, сколько их реально
   несут оба. Рёбер «доклад ↔ доклад» в графе нет намеренно: 91 узел в force-раскладке
   слипается (проверено в портфолио), а смысловая связь читается по общим темам.
3. **Обратные ссылки.** Хаб темы перечисляет все заметки, которые на него ссылаются, включая
   чужие треки. У каждой заметки — до четырёх «связанных» (общие темы с IDF-весом, тот же
   трек, соседство в зале) и минимум одна: изолированный узел — дырка в сети, а не связь.
4. **Хабы.** Событие → треки → темы. «Без трека» — тоже хаб: 27 докладов третьего дня иначе
   остались бы без родителя.

```
main#main.page
  header.page-head > p.eyebrow + h1.page-title + p.page-intro
    dl.facts > div.facts__item × 4 > dt + dd
  section.talks-section
    h2.talks-section__title
    figure.talks-graph
      div.talks-graph__canvas > svg.talks-graph__svg[role=group][aria-label]
        g.talks-graph__spokes > line × 91            ← членство: хаб ↔ заметка
        g.talks-graph__edges > line.talks-graph__edge--core|topic
        g.talks-graph__hubs > circle.talks-graph__hub--event|theme|track + text.talks-graph__label
        g.talks-graph__notes > a.talks-graph__note[href=#t<id>] > circle + circle.talks-graph__note-hit + title
                                                             ← 91 ссылка; роль `group`, а не `img`:
                                                                `img` сделал бы поддерево презентационным
      figcaption.talks-graph__caption
  section.talks-section
    section.track-group#track-<n> > h3.track-group__title
      ol.note-list > li.talk-note#t<id>
        p.talk-note__meta > a.talk-note__where[href=/day/N/#t<id>]
        p.talk-note__title
        p.talk-note__themes > a.talk-note__theme[href=#theme-<id>] × n
        p.talk-note__related > a.talk-note__link[href=#t<id>] × 1..4
  section.talks-section
    section.theme-group#theme-<id> > ul.theme-group__list > a.theme-group__link[href=#t<id>]
  footer.talks-footer > a.talks-footer__link
```

Инварианты, которые держат тесты (`tests/lib/talks-graph.test.ts`, `tests/built/talks.spec.ts`):

- раскладка **детерминирована**: один и тот же слепок даёт побайтово тот же SVG, поэтому
  `git diff` не шумит геометрией;
- темы считаются по русскому тексту всегда — даже на `/en/` (`data-track` и словарь тем);
  подпись темы переводится, классификатор один;
- клиентского скрипта у страницы **нет**: `figure` и списки приходят в HTML, интерактив —
  обычные ссылки-якоря; без JS страница читается целиком;
- все внутренние ссылки (`#t<id>`, `#theme-<id>`, `#track-<n>`) разрешаются в существующие
  `id` — проверяется обходом DOM, а не доверием;
- на 320 px вбок скроллится только `.talks-graph__canvas`, документ стоит: ось подписей
  сохраняется, страница не «уезжает»;
- подписи на кольцах: у темы — **короткая форма** (`themeShortLabel`: «AI», «A/B», «BI»,
  «Приватность»), потому что 11 полных названий (~190 px каждое) физически не влезают на
  окружность внутреннего кольца (~800 px); полное имя остаётся в `<title>` узла и в заголовке
  хаба темы ниже. Обе группы подписей проходят через один пакер: подпись садится на первый
  свободный радиус, иначе соседние треки сажали подписи друг на друга у полюсов.

Внешняя ссылка «Полная версия графа — в портфолио» размечена UTM
(`utm_content=talks-footer`) — это по-прежнему единственный внешний переход со страницы
графа, внутренние (дни, заметки, темы) UTM не носят.

## Заметки докладов (`/talk/<id>/`, `/en/talk/<id>/`)

Одна `.md` на доклад и язык — 182 файла в `src/content/{talks,talks-en}`. Факты во
frontmatter — проверяемая копия слепка: `bun run talks:check` падает, если копия
устарела (сравнивается только frontmatter-блок, строкой; тело не сравнивается —
его правит человек). `bun run talks:generate` создаёт недостающее и переписывает
только frontmatter. Адрес заметки совпадает с якорем `#t<id>` и параметром
`?talk=<id>` — это одна сущность, а не три. Страница рендерит факты из `PROGRAM`
(слепок остаётся единственным источником данных), тело — из `.md`. Модалка остаётся
быстрым просмотром и даёт ссылку «Страница доклада»; язык переключается на ту же
заметку через `alternatePath`. CI гоняет `talks:check` перед сборкой. Sitemap нет:
вход только из модалки и блока «Связанные».

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
| `.program-grid__time-cell` | заголовок группы времени: `position: static` — не липнет и уезжает вместе со своей группой; время при докладе несёт чип `.talk-card__time` |
| `.program-grid__talk-cell` | блок во всю ширину, паддинг сетки снят |
| `article.talk-card` | `block-size: auto`: карточка по контенту, минимум строки 460 px не действует |
| `.talk-card__media` у карточки **с** баннером | скрыт целиком |
| `.talk-card__media` у `.talk-card--compact` | остаётся: в нём живёт `h3` с кнопкой заголовка |
| `.talk-card__time` | виден: шапка карточки на телефоне — строка координат, а не оверлей на баннере |
| `.talk-card__hall` | виден только здесь; на десктопе `display: none` |
| `.talk-card__track` | виден только здесь: в сетке трек задан колонкой, на десктопе `display: none`. Две строки клампа — одна обрезала бы имя наполовину |
| `.talk-card__media-meta` | скрыт: трек и зал уже в шапке, дубль не нужен |
| `.talk-card__title-btn`, `.track-chip` | заголовок-кнопка — `min-block-size: 44px` (сенсорная цель, а не только визуальная высота), подписи не мельче 0.75 rem. Чип компактнее — `36px`: он в ряду фильтров, 44 px на каждом давали три строки тулбара; 36 ≥ 24 px (WCAG 2.5.8 AA) с запасом на палец |
| `div.track-chips` | `display: none` (было `flex`, чипы треков по одному). Тулбар сокращается до счётчика и экспорта: «Избранное» и «Все треки» живут в шапке, и вторая поверхность того же состояния только дублировала выбор. Узлы остаются в DOM: `[data-fav-filter]` владеет состоянием фильтра, `button[data-track]` — списком допустимых треков для клиента |
| `.talk-card__favorite`, `.talk-card__toggle-btn`, `.talk-modal__close` | целевой размер 44 px даёт псевдоэлемент (`::after`/`::before`), глиф остаётся прежнего размера |
| `header.nav-mobile` | `backdrop-filter: none`: блюр на каждой прокрутке дороже, чем даёт, а фон `color-mix(… 97%)` и так почти непрозрачен |
| `header.nav-mobile a.nav-lang` | `display: none`: место в полосе занимает кнопка треков, а ссылка на язык остаётся в `.drawer-foot` (глобус + код цели) |
| `nav.day-tabs` | липкие под шапкой, `flex-wrap: nowrap`; подпись вкладки без даты (`.day-tab__date` скрыт), поэтому три вкладки встают в строку даже на 320 px. Горизонтальный скролл остаётся страховкой, а не основным способом добраться до третьего дня |

Липкая цепочка — две ступени: `header.nav-mobile` → `nav.day-tabs`. Смещение второй —
высота первой (токен `--nav-mobile-h`), поэтому табы не заезжают под шапку. Третьей ступени
(разделителя времени) нет: полоса в 44–48 px висела над карточками ради одной подписи и
перекрывала доклады внутри длинной группы, а время при каждом докладе и так показывает чип
`.talk-card__time`.

Кнопка закрытия модалки — `position: sticky` внутри `div.talk-modal__dialog`, `inset-block-start: 0`
(не `var(--space-3)`: 12 px складывались с 16 px паддинга и вешали кнопку в 29 px от края) и
`flex: none` (иначе flex-сжимание режет цель до 22 px на длинном докладе): она остаётся
у верхнего края при любой глубине прокрутки длинного описания. Дерево разметки не менялось,
`button.talk-modal__close[data-modal-close]` остаётся прямым ребёнком диалога.


## «Связанные» в карточке

Сеть заметок графа (`/talks/`) доходит до расписания: у каждой карточки в
`div.talk-card__related` стоит 1–2 ссылки на доклады, связанные по модели
(`lib/talks-graph.ts`: общие темы с IDF-весом, тот же трек, соседство в зале). Это не
рубрика и не рекомендация редактора — тот же расчёт, что на странице графа, поэтому
карточка и заметка не могут показать разные связи.

- **Адрес ссылки — постоянный якорь заметки** (`/day/2/#t344`), а не `?talk=<id>`: у одного
  доклада не должно быть двух адресов, а ссылка обязана работать без JS. Внутри дня это
  переход по якорю (`.page :target` даёт отступ под липкую шапку), в другой день — обычный
  переход на страницу этого дня.
- **Две ссылки, по одной в строке, с многоточием.** В сетке карточка ~254 px шириной:
  полное название занимает 3–4 строки, поэтому общий кламп на две строки показал бы одну
  ссылку из трёх, а остальные оставил бы в DOM невидимыми (фокус уходил бы в обрезанный
  текст). Строка на ссылку держит блок в ~50 px, и каждая ссылка видна; полное название —
  в `title` ссылки и в карточке-цели.
- **Блок не создаёт интерактива сверх ссылок**: `article.talk-card` не обрабатывает клики
  (модалку открывает только `button.talk-card__title-btn`), поэтому ссылка внутри карточки
  не конфликтует с её собственным действием.
- **Текст ссылки переведён**, адрес — нет: заголовок берётся из overlay'я
  (`localizeTalk`), `id` и `href` остаются исходными.

## Поведение (`src/scripts/program-client.ts`)

1. **Тема**: `dark → light → cyberpunk → dark`, `localStorage['theme']`, обновление
   `meta[name=theme-color]`. До первой отрисовки ту же работу делает inline-скрипт в `<head>`.
2. **Drawer**: `body.nav-open`, `aria-expanded`, закрытие по `Esc`, scrim'у и ссылке, возврат
   фокуса на триггер. Тумблер меню виден на всех ширинах: drawer остаётся единственным путём
   к дням. Тема — уже нет: второй тумблер живёт в шапке и работает без открытия меню.
3. **День**: обычная ссылка (`/`, `/day/2/`, `/day/3/`; в EN — `/en/`, `/en/day/2/`,
   `/en/day/3/`); `aria-current="page"` у активного. Клиент день не переключает.
4. **Фильтр**: один активный чип трека (`aria-pressed`), ячейки чужого трека получают
   `hidden`, пустые ячейки остаются, счётчик и подпись пересчитываются, состояние живёт
   в `?track=` (`history.replaceState`), при 0 докладов показывается `[data-empty]`.
   Второй, независимый переключатель — «Избранное»: `button.track-chip[data-fav-filter]`,
   первый в `.track-chips`, **без `data-track`**, поэтому селектор чипов трека
   (`[data-track-chips] > button.track-chip[data-track]`) его не подхватывает ничего.
   На телефоне полоса скрыта, и этот чип остаётся в DOM только как владелец состояния:
   `initFavFilter` возвращается раньше, если узла нет, — поэтому чип нельзя удалять из
   разметки, не переписав восстановление фильтра из `sessionStorage`.
   Тот же фильтр висит на звезде в шапке (`button[data-fav-header]`, тоже
   `aria-pressed`): это переключатель, а не «показать», поэтому повторный клик возвращает
   список; клик из шапки или панели досматривает сетку (прокрутка к ней), если её верх не в
   кадре, а клик по чипу — нет, чип стоит прямо над списком.
   У фильтра трека своя кнопка в шапке (`button[data-track-header]`) — раскрывает меню из
   тех же 12 пунктов: «Все треки» + 11 треков. Выбор пункта идёт через тот же
   `setActiveTrack`, что и у чипов, поэтому список, `?track=`, чипы и пункты меню не могут
   разойтись. Нативного `<select>` в тулбаре больше нет (`DECISIONS §21`): на телефоне
   трек выбирается из этого меню, и третьей поверхности у одного состояния нет. Пункты несут `aria-pressed` (выбран ровно один),
   у кнопки `aria-expanded` и `data-active` (заливка акцентом, когда трек выбран).
   Панель не модальная: закрывается по Esc (фокус возвращается на кнопку), клику мимо и
   выбору; фокус-трапа нет. Ниже 480 px шапка показывает её вместо ссылки на язык —
   полоса в 320 px вмещает ровно пять кнопок, а язык остаётся в `.drawer-foot`.
   На телефоне (≤ 767.98 px) полоса чипов скрыта целиком, а тот же `activeTrack`
   выбирается из меню в шапке (`button[data-track-header]` → `button[data-track-option]`,
   §17): 12 подписей занимают 2147 px и в строку 358 px не влезают, а перенос давал 8 строк
   над карточками. Нативного `<select>` в тулбаре больше нет (`DECISIONS §21`): это была
   третья поверхность одного состояния. Чипы остаются в DOM и продолжают получать
   `aria-pressed` — по ним клиент проверяет `?track=`, а CSS их только скрывает.
   Условия складываются по «И»: видима ячейка, у которой (трек не выбран или совпал)
   И (избранное выключено или доклад в избранном); в URL попадает только `?track=`.
   Число в чипе — размер избранного, обновляется вместе с `[data-favorites-count]`;
   снятие звезды при включённом фильтре немедленно убирает карточку из списка.
   В режиме списка (≤767.98 px) у группы не остаётся видимых докладов → её
   `.program-grid__time-cell` тоже получает `hidden` (заголовок группы без содержимого —
   мусор). В режиме сетки разделители времени не скрываются: иначе рвётся колонка времени.
   Текст `[data-empty]` различается: пусто из-за фильтра избранного — «В избранном пока нет
   докладов этого дня», пусто из-за трека — прежняя формулировка.
5. **Счётчик**: число докладов дня (с учётом фильтра), подпись через `pluralTalks`
   (`доклад / доклада / докладов`). Не имитация «онлайна».
6. **Избранное**: `localStorage['mm-program:favorites']` (массив id), синхронизация звезды,
   `aria-pressed`, `[data-favorites-count]` (число, включая 0; атрибут стоит на двух узлах —
   в шапке и в панели — и обновляются оба) и `[data-modal-fav]`. Выбор «только избранное» —
   отдельное состояние: `sessionStorage['mm-program:favorites-only']`, общее у чипа, звезды в
   шапке и кнопки в панели, поэтому все три несут `aria-pressed` и переключаются одной
   функцией.
7. **Карточка**: `button.talk-card__title-btn` открывает модалку; «Подробнее» разворачивает
   текст в карточке (`talk-card--expanded`, подпись «Свернуть», `aria-expanded`).
8. **Модалка**: `hidden` по умолчанию; открытие — `hidden = false`, `body.is-modal-open`,
   заполнение из `/program.json`; закрытие — backdrop, кнопка, `Esc`; фокус-трап внутри
   `[data-modal-dialog]`, возврат фокуса на триггер. Слой живёт в истории браузера: открытие
   делает `pushState` с маркером `mmLayerToken`, системная «Назад» (`popstate`) закрывает
   модалку и не уводит со страницы, а пользовательское закрытие вызывает `history.back()` —
   только если верхняя запись ещё наша, иначе `back()` выкинул бы со страницы. Тот же
   механизм у drawer'а: обе панели открываются через `pushLayer`, а закрываются своими
   `closeDrawer`/`closeModal` с общей проверкой `mmLayerToken`. Поиск — третий слой того же
   механизма.
9. **`.ics`**: экспортирует видимые доклады дня (с учётом фильтра) через `buildCalendar`
   и `downloadIcs`; имя файла `matemarketing-<YYYY-MM-DD>.ics`; пустой набор → тост.
10. **Тост**: `div.mm-toast[role=status]`, живёт ~2.5 с.
11. **Поиск**: `button[data-search-open]` открывает `div.search-dialog` (`hidden = false`,
    фокус в `[data-search-input]`, запись истории через `pushLayer("search")`); закрывают
    backdrop, кнопка и `Esc`, фокус возвращается на триггер. `Esc` закрывает верхний слой:
    **поиск → модалка → drawer**. Дебаунс не нужен: `loadProgram` уже держит данные в кэше,
    ранжирование локальное; ответы нумеруются `searchSeq`, поэтому устаревший ответ не
    перетирает свежий. Пустой ввод — подсказка и пустой список, а не «все доклады».
    Запрос сравнивается через `includes`, а не `RegExp`. `href` результата —
    страница дня + `?talk=<id>`. Лок скролла — свой класс `body.is-search-open`,
    а **не** `is-modal-open`: тот включает inert-менеджер `TalkModal.astro`, и диалог
    поиска (он ребёнок `main`) стал бы недоступен для фокуса и скринридера.
    Поэтому фон инертится отдельно, из `program-client.ts`: `body > header/nav/footer`,
    `skip-link` и те дети `main`, что не содержат диалог. Тот же помощник держит
    фон инертным при открытом drawer'е — до этого Tab уходил из меню в невидимый `main`.

## Доступность и качество

- Интерактив с видимой подписью или иконкой — настоящий `button`/`a`: drawer, оба тумблера
  темы, чипы, звезда избранного, «Подробнее», экспорт `.ics`, закрытие и триггер поиска.
  Три исключения — затемнения-подложки `div.nav-scrim`, `div.talk-modal__backdrop` и
  `div.search-dialog__backdrop`: это закрытие по указателю, и у каждого слоя рядом работают
  кнопка и `Esc`, так что клик по подложке не единственный путь. `href="#"` нет нигде.
- Декоративные иконки — `::before` с CSS-маской: псевдоэлемент не попадает в дерево
  доступности, поэтому `aria-hidden` не нужен — смысл несёт подпись рядом.
- Счётчик докладов — `p.talk-count[aria-live=polite]`: фильтр переписывает число и слово,
  и скринридер слышит новое значение, не теряя фокуса.
- Счётчик выдачи поиска — `p.search-status[data-search-status][role=status][aria-live=polite]`
  (визуально скрыт): клиент пишет туда «N докладов» или «Ничего не найдено», иначе выдача
  менялась бы для скринридера молча. На закрытии текст очищается, чтобы тот же запрос
  при следующем открытии снова был объявлен.
- Пока модалка открыта, весь фон получает `inert` (плюс `aria-hidden` как фолбэк без
  поддержки `inert`); ставит и снимает его `MutationObserver` в `TalkModal.astro`.
- Табы дней — ссылки с `aria-current`; чипы — `button` с `aria-pressed`; карточка открывается
  кнопкой заголовка (не `tabindex` на `article`).
- Диалог поиска: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="search-title"`,
  фокус-трап по `Tab` внутри `[data-search-panel]`, возврат фокуса на
  `button[data-search-open]`; у триггера `aria-controls="search-dialog"` и `aria-expanded`.
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
- Сайт шлёт сам два события. `outbound_click {domain, url, surface, path, link, kind,
  network, talk_id, speaker, label}` — клики по ссылкам наружу: `link` — стабильный слаг
  (`social:<сеть>`, `portfolio:<utm_content>`, `ticket`, `source`, иначе `host/path`), по нему
  группирует тайл «топ ссылок», а `talk_id` связывает клик с докладом, из которого ушли.
  `talk_open {talk_id, talk_title, talk_track, talk_hall, talk_start, day_id, surface, path}` —
  показ модалки доклада, `surface` = `card | deeplink`. Остальное — автозахват.
- События, отправленные до загрузки SDK, копятся (до 25 штук) и улетают после `register`:
  `?talk=<id>` открывает доклад без единого клика, а SDK стартует только по первому
  взаимодействию — без очереди такой показ не попадал бы в отчёт вовсе.
- «Внешняя» ссылка — та, что ведёт за пределы base `/mm-program-page`, а не за пределы хоста:
  портфолио живёт на том же `nikitaboyarkin.github.io`, и проверка по хосту молча глушила
  клики в него.
- Ссылки на портфолио размечены UTM (`utm_source=mm-program-page`,
  `utm_medium=referral`, `utm_campaign=mm_program_to_portfolio`, `utm_content` — конкретная
  ссылка). Без разметки переход, начавшийся в новой сессии, читается как прямой заход,
  и связка двух сайтов в отчёте теряется.

## Отклонения от оригинала

Фиксируются в `README.md` и `docs/DECISIONS.md`: палитра и шрифты дизайн-системы портфолио,
шапка вместо левой app-панели, день как URL, баннер на всю ширину карточки и более высокая
строка сетки. Нет авторизации, кабинета, чата, плеера и оплаты. Медиа — hotlink с CDN
первоисточника, кроме аватарок: они ресемплируются в 144×144 на `prebuild`
(`scripts/optimize-photos.ts`, карта `src/data/photos.json`) — оригиналы весят 300–1200 КБ
при 36 px в CSS. Счётчик — доклады, не «онлайн».
