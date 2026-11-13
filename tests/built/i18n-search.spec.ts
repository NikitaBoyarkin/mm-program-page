/**
 * Проверка СОБРАННОЙ страницы для двух фич: английской версии (`/en/`,
 * `/en/day/N/`) вместе с переключателем языка и клиентского поиска по
 * программе. Тесты идут против `dist/` через `astro preview`, ничего не
 * мокают и читают тот же `/program.json`, что и клиент.
 *
 * Набор идёт в трёх проектах (`playwright.config.ts`): chromium 1280×900,
 * chromium 320×700 и WebKit iPhone 13 390×844.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from "playwright/test";

/** `base` проекта (`astro.config.mjs`): страница живёт на подпути. */
const BASE = "/mm-program-page";

const DAY1_TALKS = 39;
const TRACK_CHIPS = 11;

/**
 * Открыть путь и дождаться `load` — как в `program.spec.ts`: `load` наступает
 * после `init()` в `program-client.ts`, иначе клик уходит в элемент без
 * слушателя.
 */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState("load");
}

/**
 * Баннеры и фото спикеров приходят с чужого CDN (hotlink), и `load` ждёт их
 * все. Внешняя картинка получает 1×1 PNG (не `abort` — прерванный запрос
 * Chromium пишет в консоль как ошибку ресурса), любой другой внешний запрос —
 * abort. Тот же приём, что в `program.spec.ts`.
 */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const request = route.request();
    if (request.url().startsWith("http://127.0.0.1:4321")) return route.continue();
    if (request.resourceType() === "image") {
      return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG });
    }
    return route.abort();
  });
});

/** `hidden` как свойство DOM, а не как строка атрибута. */
async function isHidden(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((node) => (node as HTMLElement).hidden);
}

interface ProgramShape {
  days: { id: number; order: number }[];
  talks: { id: number; dayId: number; start: string; title: string }[];
}

/** Тот же файл, что читает клиент: RU — `/program.json`, EN — `/en/program.json`. */
async function readProgram(request: APIRequestContext, path: string): Promise<ProgramShape> {
  const response = await request.get(BASE + path);
  expect(response.status()).toBe(200);
  return (await response.json()) as ProgramShape;
}

/** Первый по времени доклад первого дня — запрос гарантированно что-то найдёт. */
function firstDayOneTalk(program: ProgramShape): ProgramShape["talks"][number] {
  const firstDay = [...program.days].sort((a, b) => a.order - b.order)[0];
  expect(firstDay, "в программе должен быть хотя бы один день").toBeTruthy();
  const talk = program.talks
    .filter((item) => item.dayId === firstDay!.id)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)[0];
  expect(talk, "в первом дне должен быть хотя бы один доклад").toBeTruthy();
  return talk!;
}

/**
 * Фрагмент названия для ввода в поиск. Нормализация та же, что в
 * `src/lib/search.ts` (регистр, `ё` → `е`, пробелы), иначе фрагмент с большой
 * буквы не совпал бы с нормализованным заголовком.
 */
function fragment(title: string, length = 8): string {
  return title.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim().slice(0, length).trim();
}

/** Открыть диалог поиска и дождаться, что он действительно виден. */
async function openSearch(page: Page): Promise<void> {
  await page.locator("[data-search-open]").click();
  await expect.poll(() => isHidden(page, "[data-search-dialog]")).toBe(false);
}

const CYRILLIC = /[А-Яа-яЁё]/;

test("29 · /en/ — английская страница: html[lang], data-lang, h1, 39 карточек, латинский чип трека", async ({
  page,
}) => {
  await open(page, "/en/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "en");
  await expect(page.locator("h1.page-title")).toHaveText("Conference program");

  await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);

  // Подпись чипа переведена, а `data-track` остаётся исходным: по нему клиент
  // фильтрует сетку, переведённое значение сломало бы фильтр.
  const transformation = page.locator(
    '[data-track-chips] button.track-chip[data-track="ТРАНСФОРМАЦИЯ"]',
  );
  await expect(transformation.locator(".track-chip__name")).toHaveText("TRANSFORMATION");

  const labels = await page
    .locator("[data-track-chips] > button.track-chip[data-track] .track-chip__name")
    .allTextContents();
  expect(labels.length).toBe(TRACK_CHIPS);
  expect(
    labels.filter((label) => CYRILLIC.test(label)),
    "все подписи треков на /en/ должны быть латиницей",
  ).toEqual([]);

  const ruTrackCells = await page
    .locator('div.program-grid__talk-cell[data-track="ТРАНСФОРМАЦИЯ"]')
    .count();
  expect(ruTrackCells, "data-track ячейки должен остаться русским").toBeGreaterThan(0);
});

/**
 * Ссылка на другой язык есть в двух местах: в шапке (≥ 480 px) и в панели меню
 * (везде). На телефоне шапку занимают фильтры, поэтому тест идёт тем путём,
 * который у читателя действительно есть, — а не тем, что первым попал в DOM.
 */
async function langLink(page: Page): Promise<Locator> {
  const header = page.locator("header.nav-mobile a.nav-lang");
  if (await header.isVisible()) return header;
  await page.locator("[data-nav-open]").click();
  return page.locator("#site-nav a.nav-lang");
}

test("30 · переключатель языка: /day/2/ → /en/day/2/ и обратно на /", async ({ page }) => {
  await open(page, "/day/2/");

  const headerLang = await langLink(page);
  await expect(headerLang).toHaveAttribute("href", `${BASE}/en/day/2/`);
  await expect(headerLang).toHaveAttribute("hreflang", "en");
  await headerLang.click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).pathname).toBe(`${BASE}/en/day/2/`);

  // Обратно с английского первого дня — на русский первый день (он же `/`).
  await open(page, "/en/");
  const backLang = await langLink(page);
  await expect(backLang).toHaveAttribute("href", `${BASE}/`);
  await expect(backLang).toHaveAttribute("hreflang", "ru");
  await backLang.click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  expect(new URL(page.url()).pathname).toBe(`${BASE}/`);
});

test("32 · поиск (EN): фрагмент английского названия → непустая выдача латиницей", async ({
  page,
  request,
}) => {
  const program = await readProgram(request, "/en/program.json");
  const talk = firstDayOneTalk(program);
  const query = fragment(talk.title, 12);
  expect(query.length).toBeGreaterThan(3);
  expect(CYRILLIC.test(query), "фрагмент английского названия должен быть латиницей").toBe(false);

  await open(page, "/en/");
  await openSearch(page);
  await page.locator("[data-search-input]").fill(query);

  await expect(page.locator("[data-search-results] .search-result").first()).toBeVisible();

  const titles = await page.locator("[data-search-results] .search-result__title").allTextContents();
  expect(titles.length).toBeGreaterThan(0);
  expect(
    titles.some((title) => title.toLowerCase().includes(query)),
    "выдача должна содержать доклад, чей заголовок начинается с введённого фрагмента",
  ).toBe(true);
  expect(
    titles.filter((title) => !/[A-Za-z]/.test(title)),
    "в выдаче на /en/ каждый заголовок должен содержать латиницу",
  ).toEqual([]);
});

test("33 · пустой результат: «zzzznope» → виден [data-search-empty], список пуст", async ({
  page,
}) => {
  await open(page, "/");
  await openSearch(page);

  await page.locator("[data-search-input]").fill("zzzznope");

  await expect(page.locator("[data-search-empty]")).toBeVisible();
  await expect(page.locator("[data-search-results] .search-result")).toHaveCount(0);
});

test("34 · Esc закрывает поиск и возвращает фокус на кнопку поиска", async ({ page }) => {
  await open(page, "/");
  await openSearch(page);
  await expect(page.locator("body")).toHaveClass(/is-search-open/);

  await page.keyboard.press("Escape");

  await expect.poll(() => isHidden(page, "[data-search-dialog]")).toBe(true);
  await expect(page.locator("body")).not.toHaveClass(/is-search-open/);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement === document.querySelector("[data-search-open]"),
      ),
    )
    .toBe(true);
});

test.describe("мобильный 320×700", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("35 · на /en/ 320 px: поиск и треки в шапке, язык — в drawer'е, вбок не скроллится", async ({
    page,
  }) => {
    await open(page, "/en/");

    await expect(page.locator("[data-search-open]")).toBeVisible();
    await expect(page.locator("header.nav-mobile button[data-track-header]")).toBeVisible();
    // Шестая кнопка в полосу 320 px не влезает, поэтому язык живёт в панели:
    // проверяем именно тот путь, который есть у читателя.
    await expect(page.locator("header.nav-mobile a.nav-lang")).toBeHidden();
    await page.locator("[data-nav-open]").click();
    await expect(page.locator("#site-nav a.nav-lang")).toBeVisible();
    await page.keyboard.press("Escape");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "документ не должен скроллиться вбок на 320 px").toBe(0);
  });
});

test("36 · консоль чистая: ни console.error, ни pageerror на /en/ и /en/day/2/", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // То же, что в program.spec.ts: WebKit ругается на `interactive-widget`
    // из Base.astro:113 — ключ для Chromium, не дефект страницы.
    if (message.text().includes('Viewport argument key "interactive-widget"')) return;
    problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await open(page, "/en/");
  await page.waitForTimeout(300);
  await open(page, "/en/day/2/");
  await page.waitForTimeout(300);

  expect(problems).toEqual([]);
});

test("37 · клик по результату поиска ведёт на постоянную страницу доклада", async ({
  page,
  request,
}) => {
  // Вход в модалку через `?talk=<id>` удалён: единственный адрес доклада —
  // `/talk/<id>/`. Тест держит клиентскую ссылку `.search-result`, которую
  // строит `talkHrefFor(LANG, talk.id)` (`program-client.ts:1590`).
  const program = await readProgram(request, "/program.json");
  const talk = firstDayOneTalk(program);
  const query = fragment(talk.title, 12);
  expect(query.length).toBeGreaterThan(3);

  await open(page, "/");
  await openSearch(page);
  await page.locator("[data-search-input]").fill(query);

  const first = page.locator("[data-search-results] .search-result").first();
  await expect(first).toBeVisible();
  await first.click();

  await page.waitForURL(/\/mm-program-page\/talk\/\d+\/$/);
  const title = page.locator("h1.talk-note__title");
  await expect(title).toBeVisible();
  expect((await title.innerText()).trim().length).toBeGreaterThan(0);
});
