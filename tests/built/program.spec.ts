/**
 * Проверка СОБРАННОЙ страницы программы (dist/) в реальном chromium:
 * тесты читают фактический DOM после `astro preview`, ничего не мокают и
 * не подменяют данные. 15 тестов = 15 фактов контракта.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";

const DAY1_DATE = "2026-11-26";
const DAY1_TALKS = 39;
const TOTAL_TALKS = 91;

/**
 * Открыть путь и дождаться `load`. `load` наступает после выполнения
 * модульного скрипта страницы, то есть после `init()` в program-client.ts —
 * иначе клик может уйти в элемент без слушателя.
 */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
}

/**
 * Баннеры и фото спикеров приходят с чужого CDN (hotlink), и `load` ждёт их
 * все. Ни один тест не проверяет пиксели картинки, зато на медленной сети
 * ожидание упиралось в таймаут — прогон становился флаки (поймано на 13-м
 * тесте: 20.7 с вместо 0.2 с).
 *
 * Гасим предсказуемо: внешняя картинка получает 1×1 PNG (не `abort` —
 * прерванный запрос Chromium пишет в консоль как ошибку ресурса, а тест `04`
 * обязан видеть чистую консоль), любой другой внешний запрос — abort.
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

/** id всех карточек на текущей странице, в порядке DOM. */
async function talkIds(page: Page): Promise<number[]> {
  return page
    .locator("article.talk-card[data-talk-id]")
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.talkId)));
}

/** `hidden` как свойство DOM, а не как строка атрибута. */
async function isHidden(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((node) => (node as HTMLElement).hidden);
}

test("01 · / — 39 карточек, 3 таба дней, 11 чипов, счётчик 39, активен первый таб", async ({
  page,
}) => {
  await open(page, "/");

  await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);
  await expect(page.locator("a.day-tab")).toHaveCount(3);
  await expect(page.locator("button.track-chip")).toHaveCount(11);
  await expect(page.locator("[data-talk-count]")).toHaveText(String(DAY1_TALKS));

  await expect(page.locator("a.day-tab[aria-current='page']")).toHaveCount(1);
  await expect(page.locator("a.day-tab").first()).toHaveAttribute("aria-current", "page");
});

test("02 · /day/2/ — 37 карточек и второй таб; /day/3/ — 15 карточек и третий таб", async ({
  page,
}) => {
  await open(page, "/day/2/");
  await expect(page.locator("article.talk-card")).toHaveCount(37);
  await expect(page.locator("a.day-tab[aria-current='page']")).toHaveCount(1);
  await expect(page.locator("a.day-tab").nth(1)).toHaveAttribute("aria-current", "page");

  await open(page, "/day/3/");
  await expect(page.locator("article.talk-card")).toHaveCount(15);
  await expect(page.locator("a.day-tab[aria-current='page']")).toHaveCount(1);
  await expect(page.locator("a.day-tab").nth(2)).toHaveAttribute("aria-current", "page");
});

test("03 · сумма уникальных data-talk-id по трём страницам = 91", async ({ page }) => {
  const ids = new Set<number>();

  for (const path of ["/", "/day/2/", "/day/3/"]) {
    await open(page, path);
    for (const id of await talkIds(page)) ids.add(id);
  }

  expect(ids.size).toBe(TOTAL_TALKS);
});

test("04 · консоль чистая: ни console.error, ни pageerror на / и /day/2/", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await open(page, "/");
  await page.waitForTimeout(300);
  await open(page, "/day/2/");
  await page.waitForTimeout(300);

  expect(problems).toEqual([]);
});

test("05 · фильтр по треку: aria-pressed, одинаковый data-track, счётчик, track= в URL", async ({
  page,
}) => {
  await open(page, "/");

  const chips = page.locator("button.track-chip");
  const chipCount = await chips.count();

  let index = -1;
  let track = "";
  for (let i = 0; i < chipCount; i += 1) {
    const chip = chips.nth(i);
    const count = Number((await chip.locator(".track-chip__count").innerText()).trim());
    if (count > 0) {
      index = i;
      track = (await chip.getAttribute("data-track")) ?? "";
      break;
    }
  }
  expect(index, "в первый день должен найтись трек хотя бы с одним докладом").toBeGreaterThanOrEqual(0);

  const chip = chips.nth(index);

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  const tracks = await page
    .locator("div.program-grid__talk-cell[data-track]:visible")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.track ?? null));
  expect(tracks.length).toBeGreaterThan(0);
  expect(tracks.every((value) => value === track)).toBe(true);

  const visibleCards = await page.locator("article.talk-card:visible").count();
  expect(visibleCards).toBe(tracks.length);
  await expect(page.locator("[data-talk-count]")).toHaveText(String(visibleCards));
  expect(page.url()).toContain("track=");

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-talk-count]")).toHaveText(String(DAY1_TALKS));
  expect(page.url()).not.toContain("track=");
});

test("06 · избранное: звезда, [data-favorites-count], сохранение после reload", async ({
  page,
}) => {
  await open(page, "/");
  const star = page.locator("button[data-fav][data-talk-id]").first();

  try {
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-favorites-count]")).toHaveText("1");

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.locator("button[data-fav][data-talk-id]").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-favorites-count]")).toHaveText("1");
  } finally {
    await page.evaluate(() => window.localStorage.clear());
  }
});

test("07 · модалка: hidden снят, заголовок непустой, body.is-modal-open, Esc и возврат фокуса", async ({
  page,
}) => {
  await open(page, "/");
  const trigger = page.locator("button.talk-card__title-btn").first();

  expect(await isHidden(page, "[data-modal]")).toBe(true);

  await trigger.click();
  await expect.poll(() => isHidden(page, "[data-modal]")).toBe(false);
  await expect
    .poll(async () => (await page.locator("[data-modal-title]").innerText()).trim().length)
    .toBeGreaterThan(0);
  await expect(page.locator("body")).toHaveClass(/is-modal-open/);

  // Фокус-трап: Tab не выводит фокус за пределы диалога. Проверяем 12 нажатий —
  // больше, чем интерактивных элементов в модалке, — и каждый раз ждём, что
  // активный элемент остался внутри `[data-modal-dialog]`.
  const focusInside = async (): Promise<boolean> =>
    page.evaluate(() => {
      const dialog = document.querySelector("[data-modal-dialog]");
      return !!dialog && dialog.contains(document.activeElement);
    });
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusInside()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect.poll(() => isHidden(page, "[data-modal]")).toBe(true);
  await expect(page.locator("body")).not.toHaveClass(/is-modal-open/);
  expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true);
});

test("08 · .ics: имя файла, VCALENDAR, Europe/Moscow, SUMMARY, 39 VEVENT", async ({ page }) => {
  await open(page, "/");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-export-ics]").click(),
  ]);

  expect(download.suggestedFilename()).toBe(`matemarketing-${DAY1_DATE}.ics`);
  const file = await download.path();
  expect(file, "скачивание должно быть сохранено на диск").toBeTruthy();

  const text = await readFile(String(file), "utf8");
  expect(text.startsWith("BEGIN:VCALENDAR")).toBe(true);
  expect(text).toContain("TZID=Europe/Moscow");
  expect(text).toContain("SUMMARY:");
  expect((text.match(/^BEGIN:VEVENT/gm) ?? []).length).toBe(DAY1_TALKS);
});

test.describe("мобильный 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("09 · у документа нет горизонтального overflow, но .program-grid скроллится", async ({
    page,
  }) => {
    await open(page, "/");

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

    const grid = await page.locator(".program-grid").evaluate((node) => ({
      scrollWidth: (node as HTMLElement).scrollWidth,
      clientWidth: (node as HTMLElement).clientWidth,
    }));
    expect(grid.scrollWidth).toBeGreaterThan(grid.clientWidth);
  });

  test("10 · drawer: body.nav-open, aria-expanded, Esc закрывает", async ({ page }) => {
    await open(page, "/");

    const toggle = page.locator("[data-nav-open]");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.locator("body")).toHaveClass(/nav-open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/nav-open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("11 · тема: dark → light → cyberpunk → dark, localStorage.theme повторяет", async ({
    page,
  }) => {
    await open(page, "/");

    const theme = (): Promise<string | null> => page.locator("html").getAttribute("data-theme");
    const stored = (): Promise<string | null> =>
      page.evaluate(() => window.localStorage.getItem("theme"));

    expect(await theme()).toBe("dark");

    // Тумблер темы живёт в off-canvas drawer'е — открываем его как пользователь,
    // иначе клик уходит в `visibility: hidden` элемент.
    await page.locator("[data-nav-open]").click();
    const toggle = page.locator("[data-theme-toggle]");

    await toggle.click();
    expect(await theme()).toBe("light");
    expect(await stored()).toBe("light");

    await toggle.click();
    expect(await theme()).toBe("cyberpunk");
    expect(await stored()).toBe("cyberpunk");

    await toggle.click();
    expect(await theme()).toBe("dark");
    expect(await stored()).toBe("dark");
  });
});

test("12 · /program.json — 200, application/json, 91 доклад, 3 дня", async ({ request }) => {
  const response = await request.get("/program.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("application/json");

  const body = (await response.json()) as { talks: unknown[]; days: unknown[] };
  expect(body.talks.length).toBe(TOTAL_TALKS);
  expect(body.days.length).toBe(3);
});

test.describe("без JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("13 · HTML-first: 39 карточек, 3 таба дней, 11 чипов, счётчик 39", async ({ page }) => {
    await open(page, "/");

    await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);
    await expect(page.locator("a.day-tab")).toHaveCount(3);
    await expect(page.locator("button.track-chip")).toHaveCount(11);
    await expect(page.locator("[data-talk-count]")).toHaveText(String(DAY1_TALKS));
  });
});

// Регрессия: на десктопе тумблер меню был `display: none` (базовое правило
// `site.css`), а сам drawer — единственный путь к смене темы и к дням. Значит
// при ≥1024 px тема и навигация становились недостижимы мышью и клавиатурой.
test.describe("десктоп 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("14 · drawer и тумблер темы достижимы и на десктопе", async ({ page }) => {
    await open(page, "/");

    const toggle = page.locator("[data-nav-open]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator("body")).toHaveClass(/nav-open/);

    const themeToggle = page.locator("[data-theme-toggle]");
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

// Регрессия печати: `@media print` скрывал `.talk-card__media` целиком, а у
// 13 карточек без баннера заголовок лежит внутри `.talk-card__media-text` —
// на бумаге они выходили безымянными. Теперь скрывается только `<img>`.
test("15 · печать: у карточки без баннера заголовок остаётся, баннер скрыт", async ({ page }) => {
  await open(page, "/");
  await page.emulateMedia({ media: "print" });

  const compact = page.locator("article.talk-card--compact").first();
  await expect(compact).toHaveCount(1);
  await expect(compact.locator(".talk-card__topic-title")).toBeVisible();
  await expect(page.locator("img.talk-card__banner-img").first()).toBeHidden();
});
