# CONTRACT — mm-program-page

Замороженный интерфейс. Правки в него вносятся только оркестратором, и только вместе
с правкой этого файла. Все агенты кодируют против него, а не против своих догадок.

## Что это

Статическая копия страницы программы конференции
`https://lms.matemarketing.ru/events/all/6/program` (Матемаркетинг 2026):
сайдбар, хлебные крошки, табы дней, фильтр по трекам, сетка «время × залы»,
карточки докладов, модалка доклада. Без сборки, без бэкенда, без npm-зависимостей:
открывается двойным кликом по `index.html` (file://) и живёт на любом статик-хостинге.

## Файлы и владельцы

| Путь | Владелец | Назначение |
| --- | --- | --- |
| `index.html` | оркестратор | разметка-скелет, хуки `data-*` |
| `assets/styles.css` | CSS-агент | токены + базовые правила + программа + адаптив |
| `assets/app.js` | JS-агент | рендер сетки, табы, фильтр, модалка, избранное, .ics |
| `data/program.js` | data-агент | `window.MM_PROGRAM = {...}` — единственный источник данных |
| `tools/fetch_program.py` | data-агент | пересборка `data/program.js` из API первоисточника |
| `tests/test_page.py` | verify-агент | рендер в headless Chrome: счётчики, геометрия, скриншоты |
| `tests/test_data.py` | data-агент | инварианты нормализованных данных |
| `assets/vendor/base-raw.css`, `assets/vendor/program-raw.css` | оркестратор | выгрузка CSS первоисточника (только чтение) |

`assets/vendor/*` — выгрузка боевого CSS: `base-raw.css` (сайдбар, навигация,
layout, хлебные крошки, типографика) и `program-raw.css` (сетка, карточки, табы,
чипы, счётчик). Это референс, а не файл для прямого подключения: CSS-агент
собирает из него `assets/styles.css` (снимает `[data-v-*]`, добавляет токены
и адаптив, чистит мёртвое).

## Данные: `window.MM_PROGRAM`

```js
{
  source: "https://lms.matemarketing.ru/api/event-program/event/6/",
  generatedAt: "2026-11-02T20:15:00Z",
  event: { id: 6, name: "Матемаркетинг 2026", startDate: "2026-11-17", endDate: "2026-11-27" },
  halls: [{ id: 43, name: "Молекула", order: 0 }, ...],           // глобальный порядок залов
  tracks: [{ id: 28, name: "ТРАНСФОРМАЦИЯ", description: "" }, ...],
  days: [{
    id: 10, date: "2026-11-26", name: "1 день",
    halls: ["Молекула", "Атом", "Архангельск", "Физика", "Кинетика"],   // порядок колонок этого дня
    talkIds: [267, ...]                                                  // порядок не важен
  }],
  talks: [{
    id: 267,
    dayId: 10,
    hall: "Молекула",
    track: "ТРАНСФОРМАЦИЯ",
    trackId: 28,
    title: "Как прогресс в современных мультимодальных моделях влияет на профессию DS/DA/ML",
    start: "11:00", end: "12:10",            // "HH:MM", локальное время конференции (МСК)
    image: "https://…/babushkin.png",        // баннер 16:9 либо null
    lectors: [{ name: "Валерий Бабушкин", role: "Старший главный начальник, BP", photo: "https://…" }],
    short: "…",                              // short_description — текст для карточки
    description: "…",                        // полный текст для модалки (может быть "")
    highlighted: false, free: false, broadcastType: "stream"
  }]
}
```

Правила нормализации:

- `short` = `short_description`, если пусто → первый абзац `description`, если и его нет → `""`.
- `lectors[].name` = `first_name + ' ' + last_name` (+ отчество, если есть).
- `days[].halls` — залы, у которых в этом дне есть доклады, отсортированные по `hall.order`.
- `talkIds` можно не заполнять, если `talks` уже содержит `dayId`; приложение
  фильтрует `talks` по `dayId`, так что `talkIds` необязателен.
- Никаких `undefined`, `null`-строк и HTML-тегов в текстах: только plain text.

## Разметка и классы (CSS ↔ JS контракт)

Сетка повторяет классы оригинала — от них зависят выгруженные правила.

```
.program-grid > .program-grid__container
  .program-grid__halls-header        // grid, колонки = var(--mm-grid-cols)
    .program-grid__time-label        // "Время"
    .program-grid__hall-name × N
  .program-grid__content             // grid, grid-auto-rows: minmax(390px, auto)
    .program-grid__time-cell         // style="grid-area: R / 1"; текст start
    .program-grid__talk-cell         // style="grid-area: R / C / span N"
      .talk-card[.talk-card--double-slot.talk-card--multi-slot]
        .talk-card__top[.talk-card__top--dark|--light]
          .talk-card__header[.talk-card__header--overlay]
            span.talk-card__time     // "11:00 - 12:10"
            button.talk-card__favorite[.talk-card__favorite--active]
          .talk-card__media
            img.talk-card__banner-img            // если есть image
            | .talk-card__media-text             // если image === null
                h3.talk-card__topic-title
                .talk-card__media-meta > .talk-card__meta-item
        .talk-card__bottom.talk-card__bottom--light
          .talk-card__speakers > .talk-card__speaker
            img.talk-card__speaker-photo
            .talk-card__speaker-info
              span.talk-card__speaker-name
              span.talk-card__speaker-desc
          .talk-card__content
            .talk-card__theses[.talk-card__theses--short|--double]
            button.talk-card__toggle-btn     // "Подробнее"
```

Колонки сетки задаются CSS-переменной на `.program-grid`:
`--mm-grid-cols: 100px repeat(var(--mm-hall-count), minmax(340px, 420px))` — эти
значения измерены на эталоне при 1440 px (колонка времени 99–100, зал 420, карточка 391).
Уже 1280 px — `70px repeat(N, minmax(310px, 390px))` и горизонтальный скролл.

Слот карточки: высота слота в строках `N = число строк времени, которые
доклад перекрывает`. `N > 1` → ячейке `--double` и `span N`, карточке
`talk-card--double-slot talk-card--multi-slot`.

## Поведение

1. **Табы дней** (`[data-tabs]`): кнопка на день, `.program-tab.program-tab--active`,
   `aria-selected`, `role="tab"`. Первый день активен при загрузке. Смена дня
   перерисовывает чипы треков, сетку и счётчик.
2. **Чипы треков** (`[data-tracks]`): `.track-chip`, активный — `.track-chip--active`,
   `aria-pressed`. Клик по чипу фильтрует: в сетке остаются только доклады этого
   трека (пустые ячейки сохраняются), повторный клик снимает фильтр. Чипы — **все
   треки программы** (11), как в отрендеренном DOM оригинала; трек без докладов
   в этот день даёт пустую сетку и сообщение.
3. **Счётчик** (`[data-viewers-count]`): число докладов выбранного дня (с учётом
   фильтра) — честная величина, не имитация «онлайна». Подпись склоняется:
   `доклад` / `доклада` / `докладов`.
4. **Карточка**: клик по карточке (кроме кнопок «Подробнее» и звезды) открывает
   модалку. «Подробнее» разворачивает текст в карточке (`talk-card--expanded`,
   текст меняется на «Свернуть»).
5. **Избранное**: звезда `[data-fav]` переключает состояние, хранится в
   `localStorage` под ключом `mm-program:favorites` (массив id). Счётчик в сайдбаре
   `[data-favorites-count]` показывает число избранных; в модалке кнопка
   `[data-modal-fav]` синхронна.
6. **Модалка** (`[data-modal]`): `hidden` по умолчанию; открытие — `hidden = false`
   + `document.body.classList.add('is-modal-open')`; закрытие — клик по backdrop,
   кнопка, `Esc`; фокус-трап внутри `[data-modal-dialog]`, возврат фокуса на карточку.
7. **`Загрузить .ics`** (`[data-export-ics]`): собирает `.ics` (VEVENT на доклад,
   `DTSTART`/`DTEND` из `date + start/end`, `TZID=Europe/Moscow`, `SUMMARY`, `LOCATION`,
   `DESCRIPTION`), скачивает файл `matemarketing-2026-<day>.ics` через Blob.
8. **Мобильное меню**: `[data-sidebar-open]` / `[data-sidebar-close]` переключают
   класс `sidebar--open` на `[data-sidebar]`, backdrop — `.sidebar-backdrop`.
9. **«Войти»** (`[data-open-auth]`): заглушка — тост «Нужен бэкенд: это статическая копия».

## Доступность и качество

- Все интерактивные элементы — `button`/`a`, не `div` с обработчиком.
- Клавиатура: табы — стрелки влево/вправо, чипы — `Enter`/`Space`, карточка — `Enter`.
- `prefers-reduced-motion: reduce` отключает переходы карточек и модалки.
- Никаких `href="#"` без обработчика; внешние ссылки — `rel="noopener"`.
- Тексты в разметке — `textContent`, никогда `innerHTML` для пользовательских строк.
- Консоль чистая: ни одного `console.error` при загрузке и переключении дня.

## Отклонения от оригинала (фиксируются в README)

- Нет авторизации, личного кабинета, избранного на сервере, чата и плеера.
- Баннеры и фото спикеров грузятся с CDN первоисточника (hotlink), в репозитории их нет.
- Заголовочный шрифт Loos Wide подключается с CDN первоисточника, не распространяется.
- Счётчик в шапке показывает число докладов, а не «людей онлайн»: у статики нет
  присутствия, и выдумывать его нельзя.
