/**
 * Проверка СОБРАННОЙ страницы графа (`/talks/`, `/en/talks/`) в реальном
 * браузере. Как и `program.spec.ts`, набор идёт против `dist/` через
 * `astro preview` и ничего не мокает; идёт в тех же трёх проектах.
 *
 * Три вещи, которые здесь важны и которые нельзя проверить юнит-тестом:
 * 1) SVG реально отрендерен, и все 91 точка ведут на существующие якоря;
 * 2) на 320 px вбок скроллится только рамка графа, а не документ;
 * 3) вход в граф есть на каждой ширине — полосой шапки, иконкой или меню.
 */
import { expect, test, type Page } from "playwright/test";

const BASE = "/mm-program-page";
const TALKS = 91;
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

test("31 · /talks/ — 91 заметка с постоянными адресами, 12 треков, 11 тем", async ({ page }) => {
  await open(page, "/talks/");

  await expect(page.locator("h1.page-title")).toHaveText("Граф докладов");

  // Факты считает та же модель, что рисует страницу. Проверяем не «83» как
  // константу (словарь тем живёт и число меняется), а согласие: число в
  // фактах равно числу нарисованных рёбер трек ↔ тема.
  const facts = (await page.locator("dl.facts .facts__item dd").allTextContents()).map((value) =>
    Number(value.trim()),
  );
  expect(facts.slice(0, 3)).toEqual([TALKS, TRACKS, THEMES]);

  const drawn = await page.locator("line.talks-graph__edge--topic").count();
  expect(drawn, "связей трек ↔ тема должно быть больше, чем треков").toBeGreaterThan(TRACKS);
  expect(facts[3]).toBe(drawn);

  await expect(page.locator("li.talk-note")).toHaveCount(TALKS);

  // Каждая заметка — атомарная единица с адресом `#t<id>`, и её день-ссылка
  // ведёт на тот же якорь в расписании. День-ссылка — локатор: после разделения
  // адресов она осталась на дне (`/day/N/#t<id>`), а канон живёт в hrefTalk.
  const anchors = await page.locator("li.talk-note").evaluateAll((nodes) =>
    nodes.map((node) => {
      const item = node as HTMLElement;
      const link = item.querySelector<HTMLAnchorElement>("a.talk-note__where");
      return { id: item.id, href: link?.getAttribute("href") ?? "" };
    }),
  );
  expect(new Set(anchors.map((item) => item.id)).size).toBe(TALKS);
  for (const item of anchors) {
    expect(item.id).toMatch(/^t\d+$/);
    expect(item.href).toContain(`#${item.id}`);
    // День 1 живёт на корне локали, остальные — в `day/N/`: обе формы валидны.
    expect(item.href).toMatch(/^.*(?:\/day\/\d+\/|\/)#t\d+$/);
    // Подпись «День N · время · зал» описывает место — канон бы её обманул.
    expect(item.href, `строка «где» должна вести на день: ${item.href}`).not.toContain("/talk/");
  }
});

test("32 · граф отрендерен на билде: SVG, 91 точка, все точки ведут на канон /talk/<id>/", async ({
  page,
}) => {
  await open(page, "/talks/");

  const svg = page.locator("svg.talks-graph__svg");
  await expect(svg).toBeVisible();
  // `group`, а не `img`: внутри 91 ссылка-точка, и `img` сделал бы всё
  // поддерево презентационным для скринридера.
  await expect(svg).toHaveAttribute("role", "group");
  await expect(svg).toHaveAttribute("aria-label", /Граф связей/);

  await expect(page.locator("a.talks-graph__note")).toHaveCount(TALKS);

  // Точка — ссылка на доклад, а не якорь на этой странице: канон у заметки
  // один (`/talk/<id>/`), и точка с карточкой расписания ведут в одно место.
  const noteHrefs = await page.locator("a.talks-graph__note").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href") ?? ""),
  );
  for (const href of noteHrefs) {
    expect(href, `точка графа должна вести на канон: ${href}`).toMatch(
      /^\/mm-program-page\/(?:en\/)?talk\/\d+\/$/,
    );
  }
  // 91 точка = 91 доклад: ни дублей, ни потерянных адресов.
  expect(new Set(noteHrefs).size).toBe(TALKS);

  // Оставшиеся `#`-ссылки страницы (хабы тем внутри текста заметок) по-прежнему
  // обязаны находить свой якорь: разделение адресов их не отменяет.
  const broken = await page.evaluate(() => {
    const ids = new Set([...document.querySelectorAll("[id]")].map((node) => node.id));
    const targets = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    return targets
      .map((link) => link.getAttribute("href")?.slice(1) ?? "")
      .filter((id) => id.length > 0 && !ids.has(id));
  });
  expect(broken, "каждая внутренняя ссылка обязана находить свой якорь").toEqual([]);

  // Клиентского скрипта у страницы нет: граф статичен, поэтому проверять
  // гидратацию нечего — вместо этого счётчик нод совпадает с моделью.
  await expect(page.locator("text.talks-graph__label--track")).toHaveCount(TRACKS);
  await expect(page.locator("text.talks-graph__label--theme")).toHaveCount(THEMES);
});

test("33 · темы — обратные ссылки: 11 хабов, каждый список ведёт к заметкам по канону", async ({
  page,
}) => {
  await open(page, "/talks/");

  const groups = page.locator("section.theme-group");
  await expect(groups).toHaveCount(THEMES);

  const rows = await page.locator("section.theme-group").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.id,
      links: node.querySelectorAll("a.theme-group__link").length,
      count: Number(node.querySelector(".theme-group__count")?.textContent?.trim() ?? "-1"),
      hrefs: [...node.querySelectorAll<HTMLAnchorElement>("a.theme-group__link")].map(
        (link) => link.getAttribute("href") ?? "",
      ),
    })),
  );
  for (const group of rows) {
    expect(group.id).toMatch(/^theme-[a-z]+$/);
    expect(group.links).toBeGreaterThan(0);
    expect(group.count).toBe(group.links);
    // Хаб темы ведёт к докладу, а не к якорю на этой же странице.
    for (const href of group.hrefs) {
      expect(href, `хаб темы должен вести на канон: ${href}`).toMatch(
        /^\/mm-program-page\/(?:en\/)?talk\/\d+\/$/,
      );
    }
  }
});

test("34 · связанные доклады: у каждой заметки есть связи, и они ведут на канон", async ({ page }) => {
  await open(page, "/talks/");

  const blocks = await page.locator("li.talk-note").evaluateAll((nodes) =>
    nodes.map((node) => node.querySelectorAll("a.talk-note__link").length),
  );
  expect(blocks.length).toBe(TALKS);
  for (const count of blocks) {
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(4);
  }
  await expect(page.locator("li.talk-note a.talk-note__link").first()).toBeVisible();

  // «Связанные» — про заметку, поэтому адрес канонический, а не якорь в списке.
  const hrefs = await page.locator("li.talk-note a.talk-note__link").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href, `связанная заметка должна вести на канон: ${href}`).toMatch(
      /^\/mm-program-page\/(?:en\/)?talk\/\d+\/$/,
    );
    expect(href).not.toContain("#");
  }
});

test("35 · вход в граф: полоса шапки на десктопе, меню на телефоне, иконка в середине", async ({
  page,
}) => {
  await open(page, "/talks/");
  const width = page.viewportSize()?.width ?? 1280;

  const inline = page.locator("header.nav-mobile a.nav-link--talks");
  const icon = page.locator("header.nav-mobile a.nav-graph");
  const drawer = page.locator("#site-nav a.drawer-link--talks");

  // Панель меню — общий знаменатель: пункт есть на всех ширинах.
  await expect(drawer).toHaveAttribute("href", `${BASE}/talks/`);
  await expect(drawer).toHaveAttribute("aria-current", "page");

  // Текущая страница маркируется только на самом графе.
  await expect(drawer).toHaveAttribute("aria-current", "page");
  if (width >= 1024) {
    await expect(inline).toBeVisible();
    await expect(inline).toHaveAttribute("aria-current", "page");
    await expect(icon).toBeHidden();
  } else if (width >= 480) {
    await expect(inline).toBeHidden();
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("aria-current", "page");
  } else {
    await expect(inline).toBeHidden();
    await expect(icon).toBeHidden();
  }
});

test.describe("планшет 768×900 — полоса ссылок скрыта, вход иконкой", () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test("35a · в шапке видна иконка графа, а не пункт полосы и не пункт меню", async ({ page }) => {
    await open(page, "/");

    const inline = page.locator("header.nav-mobile a.nav-link--talks");
    const icon = page.locator("header.nav-mobile a.nav-graph");

    await expect(inline).toBeHidden();
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("href", `${BASE}/talks/`);

    // Иконка не ломает полосу: ни документ, ни шапка не скроллятся вбок.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

    const header = await page.locator("header.nav-mobile").evaluate((node) => ({
      scrollWidth: (node as HTMLElement).scrollWidth,
      clientWidth: (node as HTMLElement).clientWidth,
    }));
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);

    // Ведёт на граф и помечает текущую страницу, когда мы на ней.
    await page.goto(`${BASE}/talks/`);
    await expect(icon).toHaveAttribute("aria-current", "page");
  });
});

test("36 · /en/talks/ — английская копия: html[lang], h1, канонический адрес и пара hreflang", async ({
  page,
}) => {
  await open(page, "/en/talks/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1.page-title")).toHaveText("Talks graph");
  await expect(page.locator("li.talk-note")).toHaveCount(TALKS);

  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBe("https://nikitaboyarkin.github.io/mm-program-page/en/talks/");

  const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      lang: node.getAttribute("hreflang"),
      href: node.getAttribute("href"),
    })),
  );
  expect(alternates.map((item) => item.lang).sort()).toEqual(["en", "ru", "x-default"]);
  expect(alternates.find((item) => item.lang === "ru")?.href).toBe(
    "https://nikitaboyarkin.github.io/mm-program-page/talks/",
  );
});

test("37 · на телефоне вбок скроллится только рамка графа, документ стоит", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, "/talks/");

  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

  // Сам граф — собственный скроллпорт: 91 точка и 22 подписи в 320 px не
  // влезают, и это осознанно: подписи остаются читаемыми.
  const canvas = await page.locator(".talks-graph__canvas").evaluate((node) => ({
    scrollWidth: (node as HTMLElement).scrollWidth,
    clientWidth: (node as HTMLElement).clientWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  expect(canvas.overflowX).toBe("auto");
  expect(canvas.scrollWidth).toBeGreaterThan(canvas.clientWidth);

  // Пункты «Граф докладов» и «К расписанию» достижимы и не обрезаны.
  await expect(page.locator("a.talks-footer__link").first()).toBeVisible();
});

test("38 · тело программы на телефоне без чипов: «Избранное» и трек — только в шапке", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, "/");

  // Полоса чипов скрыта целиком, но узлы остаются в DOM: чип избранного
  // владеет состоянием, а чипы трека — списком допустимых значений.
  await expect(page.locator("[data-track-chips]")).toBeHidden();
  await expect(page.locator("button.track-chip[data-fav-filter]")).toHaveCount(1);
  await expect(page.locator("button.track-chip[data-fav-filter]")).toBeHidden();

  // Нативного списка трека больше нет ни в разметке, ни в разметке дня.
  await expect(page.locator("[data-track-select]")).toHaveCount(0);

  // Те же два фильтра — в шапке, и они работают.
  const star = page.locator("header.nav-mobile button[data-fav-header]");
  const tracks = page.locator("header.nav-mobile button[data-track-header]");
  await expect(star).toBeVisible();
  await expect(tracks).toBeVisible();

  await tracks.click();
  await expect(page.locator("#track-menu")).toBeVisible();
  // Меню шапки — сброс плюс 11 именованных треков. «Без трека» — хаб графа,
  // а не трек: фильтровать по нему в расписании нечего.
  await expect(page.locator("#track-menu button[data-track-option]")).toHaveCount(12);
});

test("39 · страница дня: якорь #t<id> существует для каждой карточки", async ({ page }) => {
  await open(page, "/");

  const ids = await page.locator("article.talk-card[data-talk-id]").evaluateAll((nodes) =>
    nodes.map((node) => Number((node as HTMLElement).dataset.talkId)),
  );
  const anchors = await page.locator("div.program-grid__talk-cell[id]").evaluateAll((nodes) =>
    nodes.map((node) => node.id),
  );
  for (const id of ids) expect(anchors).toContain(`t${id}`);
});
