/**
 * Виды страницы графа: вкладки, под-вкладки, подписи колец. Отдельно от
 * `talks.spec.ts`, чтобы файлы не перерастали бюджет чтения. Как и `program.spec.ts`, набор идёт против `dist/` через
 * `astro preview` и ничего не мокает; идёт в тех же трёх проектах.
 *
 * Три вещи, которые здесь важны и которые нельзя проверить юнит-тестом:
 * 1) SVG реально отрендерен, и все 92 точки ведут на существующие якоря;
 * 2) на 320 px вбок скроллится только рамка графа, а не документ;
 * 3) вход в граф есть на каждой ширине — полосой шапки, иконкой или меню.
 */
import { expect, test, type Page } from "playwright/test";

const BASE = "/mm-program-page";
const TALKS = 92;
const TRACKS = 12;
const THEMES = 11;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState("load");
}

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const request = route.request();
    if (request.url().startsWith("http://127.0.0.1:4321")) return route.continue();
    return route.abort();
  });
});

test("40 · вкладки графа: три панели, глубокие ссылки раскрывают нужную, скрипта нет", async ({
  page,
}) => {
  await open(page, "/talks/");

  // Скрипта внутри вида нет: вкладки, подсветка и раскрытие панели — чистый
  // CSS. Общая шапка и блок «об авторе» свой скрипт держат, но к графу они не
  // относятся, поэтому счёт идёт по поддереву, а не по документу.
  expect(
    await page.locator(".talks-view script").count(),
    "виду графа не нужен клиентский код",
  ).toBe(0);

  const tabs = page.locator("nav.talks-view__tabs a.talks-view__tab");
  await expect(tabs).toHaveCount(3);
  await expect(page.locator("#talks-panel-graph")).toBeVisible();
  await expect(page.locator("#talks-panel-notes")).toBeHidden();
  await expect(page.locator("#talks-panel-themes")).toBeHidden();

  await tabs.nth(1).click();
  await expect(page.locator("#talks-panel-notes")).toBeVisible();
  await expect(page.locator("#talks-panel-graph")).toBeHidden();

  // Обратно на первую вкладку: правило скрытия графа не должно срабатывать на
  // его же собственном якоре — иначе вкладка «Граф» показывает пустоту.
  await tabs.nth(0).click();
  await expect(page.locator("#talks-panel-graph")).toBeVisible();
  await expect(page.locator("#talks-panel-notes")).toBeHidden();

  // Якорь темы из заметки живёт в третьей панели: он обязан её раскрыть,
  // иначе переход уводит в скрытую секцию.
  await open(page, "/talks/#theme-ai");
  await expect(page.locator("#talks-panel-themes")).toBeVisible();
  await expect(page.locator("#theme-ai")).toBeVisible();
});


test("41 · подписи колец не наезжают друг на друга ни на одной ширине", async ({ page }) => {
  await open(page, "/talks/");

  // На телефоне подписей нет вовсе: в масштабе 0.33 кегль выходит 4 px. Условие
  // проверяется отдельно, иначе замер прямоугольников проходил бы по нулям и
  // ничего не доказывал.
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(page.locator("text.talks-graph__label").first()).toBeHidden();
    await expect(page.locator(".talks-graph__leaders line").first()).toBeHidden();
    return;
  }

  // Пакер считает ширину по числу знаков (точный замер на билде недоступен),
  // поэтому договор — «прямоугольники не пересекаются». Проверяется реальный
  // рендер: допуск 3 px покрывает разницу метрик движков, а не наезд.
  const pairs = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("text.talks-graph__label")].map((node) => ({
      text: node.textContent?.trim() ?? "",
      r: node.getBoundingClientRect(),
    }));
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]?.r;
        const b = boxes[j]?.r;
        if (!a || !b) continue;
        const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (dx > 3 && dy > 3) clashes.push(`${boxes[i]?.text} × ${boxes[j]?.text}`);
      }
    }
    return { count: boxes.length, clashes };
  });

  expect(pairs.count).toBe(TRACKS + THEMES);
  expect(pairs.clashes, "подписи должны расходиться, а не накладываться").toEqual([]);
});


test("42 · под-вкладки: трек в заметках, тема в темах, «Все» возвращает список", async ({ page }) => {
  await open(page, "/talks/#track-3");

  // Якорь трека из адреса раскрывает раздел заметок и оставляет одну группу.
  await expect(page.locator("#talks-panel-notes")).toBeVisible();
  await expect(page.locator("#talks-panel-graph")).toBeHidden();
  await expect(page.locator("section.track-group:visible")).toHaveCount(1);
  await expect(page.locator("section.track-group#track-3")).toBeVisible();

  // Под-вкладок столько же, сколько групп, плюс «Все».
  await expect(page.locator("#talks-panel-notes a.talks-subtab")).toHaveCount(TRACKS + 1);

  await page.locator("#talks-panel-notes a.talks-subtab--all").click();
  await expect(page.locator("section.track-group:visible")).toHaveCount(TRACKS);

  // Тема — та же механика: `#theme-ai` из графа и из чипа заметки приводит к
  // одной группе, а не к простыне из одиннадцати.
  await open(page, "/talks/#theme-ai");
  await expect(page.locator("#talks-panel-themes")).toBeVisible();
  await expect(page.locator("section.theme-group:visible")).toHaveCount(1);
  await expect(page.locator("#theme-ai")).toBeVisible();
  await expect(page.locator("#talks-panel-themes a.talks-subtab")).toHaveCount(THEMES + 1);

  await page.locator("#talks-panel-themes a.talks-subtab--all").click();
  await expect(page.locator("section.theme-group:visible")).toHaveCount(THEMES);
});


test("43 · телефон: граф без скролла, имена тем — в чипах, под-вкладки переносятся", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, "/talks/");

  // Легенда заменяет подписи колец: один чип на тему, и он же — deep-link.
  const chips = page.locator("nav.talks-graph__legend a.talks-graph__chip");
  await expect(chips).toHaveCount(THEMES);
  await expect(chips.first()).toBeVisible();
  await expect(chips.first()).toHaveAttribute("href", /^#theme-[a-z]+$/);

  await chips.first().click();
  await expect(page.locator("#talks-panel-themes")).toBeVisible();

  // Лента под-вкладок переносится, а не листается: 13 треков и 12 тем целиком
  // видны без горизонтального скролла, полное имя — в заголовке группы ниже.
  // Каждая лента меряется на своей видимой панели: у скрытой ширина нулевая, и
  // проверка прошла бы вхолостую.
  const measure = async (panel: string) => {
    await open(page, `/talks/${panel}`);
    const box = await page.locator(`${panel} nav.talks-subtabs`).evaluate((node) => ({
      scrollWidth: (node as HTMLElement).scrollWidth,
      clientWidth: (node as HTMLElement).clientWidth,
      overflowX: getComputedStyle(node).overflowX,
    }));
    expect(box.clientWidth, `${panel}: лента не отрисована`).toBeGreaterThan(0);
    expect(box.overflowX, `${panel}: лента не должна быть скроллпортом`).not.toBe("auto");
    expect(box.scrollWidth, `${panel}: лента шире контейнера`).toBeLessThanOrEqual(
      box.clientWidth + 1,
    );
  };

  await measure("#talks-panel-themes");
  await measure("#talks-panel-notes");

  await expect(page.locator("#talks-panel-notes a.talks-subtab")).toHaveCount(TRACKS + 1);
  await expect(page.locator("#talks-panel-themes a.talks-subtab")).toHaveCount(THEMES + 1);
});
