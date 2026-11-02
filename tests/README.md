# tests/

`python3 tests/test_page.py` — браузерные проверки страницы (headless Chrome, только стандартная библиотека).

- `test_day1_default_render` — 39 карточек, 5 залов, 11 чипов, 3 таба, их подписи и `aria-selected`: дефолтный день не деградировал.
- `test_day2_and_online_day` — `?day=11` / `?day=12`: 37/15 карточек, 5/3 зала и `[data-viewers-count]` = числу карточек (счётчик не врёт).
- `test_no_placeholder_text` — в `[data-grid]`, `[data-tabs]`, `[data-tracks]` нет `undefined`, `NaN`, `null`, `[object Object]`.
- `test_every_card_has_visible_title` — ни одной карточки без заголовка или баннера с непустым `alt`, и у каждой есть доступное имя.
- `test_grid_geometry_is_sound` — у каждой ячейки есть `grid-area`, нет двух ячеек в одном слоте, колонок = залы+1, строки подряд с 1.
- `test_screenshots_desktop_and_narrow` — PNG 1440x1200 (>1000 px, >50 КБ) и 390x900 в iframe; плотность пикселей доказывает, что страница нарисована.
- `test_graceful_degradation_without_data` — пустые данные дают сообщение, а не пустой экран и не падение JS.

Время: ~8–10 с (6 запусков браузера), потолок ~120 с. Сеть не нужна: DNS внутри Chrome погашен, битые CDN-картинки на результат не влияют.
Chrome ищется в `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, затем Chromium и `google-chrome`/`chromium` в `PATH`; если браузера нет — тесты помечаются `skipped`, а не падают.
`MM_PAGE_ROOT=/tmp/broken python3 tests/test_page.py` — прогнать те же проверки против копии страницы (mutation control).
