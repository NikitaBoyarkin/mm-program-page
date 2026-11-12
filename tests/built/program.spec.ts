/**
 * Проверка СОБРАННОЙ страницы программы (dist/) в реальном браузере:
 * тесты читают фактический DOM после `astro preview`, ничего не мокают и
 * не подменяют данные. 30 тестов = 30 фактов контракта; набор идёт в трёх
 * проектах (`playwright.config.ts`): chromium 1280×900, chromium 320×700
 * и WebKit iPhone 13 390×844.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Locator, type Page } from "playwright/test";

/**
 * `base` проекта (`astro.config.mjs`): страница живёт на подпути, корень
 * домена отдаёт 404. Пути в тестах относительные, префикс добавляет `open`.
 */
const BASE = "/mm-program-page";

const DAY1_DATE = "2026-11-26";
const DAY1_TALKS = 39;
const TOTAL_TALKS = 91;

/**
 * Открыть путь и дождаться `load`. `load` наступает после выполнения
 * модульного скрипта страницы, то есть после `init()` в program-client.ts —
 * иначе клик может уйти в элемент без слушателя.
 */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
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

/** Названия докладов из того же `/program.json`, что читает клиент: id → текст. */
async function talkTitles(request: APIRequestContext): Promise<Map<number, string>> {
  const response = await request.get(BASE + "/program.json");
  const body = (await response.json()) as { talks: { id: number; title: string }[] };
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  return new Map(body.talks.map((talk) => [Number(talk.id), normalize(talk.title)]));
}

/**
 * Кнопка-заголовок — единственная сенсорная цель карточки, поэтому у неё два
 * обязательства: текст совпадает с названием доклада (это видимая кнопка, а не
 * прозрачная обёртка) и высота не меньше 44 px — и в мобильном списке, и в
 * десктопной сетке, где заголовок может занять несколько строк.
 */
/**
 * Выбирает трек тем управлением, которое видно на текущей ширине: чип
 * (десктоп) или нативный список в `label.track-select` (≤ 767.98 px, CONTRACT §4).
 * `value === ""` снимает фильтр. `aria-pressed` у чипа проверяется отдельно —
 * клиент обновляет его и у скрытого чипа, поэтому состояние одно.
 */
async function chooseTrack(page: Page, chip: Locator, value: string): Promise<void> {
  const select = page.locator("[data-track-select]");
  if (await select.isVisible()) await select.selectOption(value);
  else await chip.click();
}

async function assertTitleButtons(page: Page, request: APIRequestContext): Promise<void> {
  const titles = await talkTitles(request);

  const buttons = await page.locator("article.talk-card[data-talk-id]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const card = node as HTMLElement;
      const button = card.querySelector<HTMLElement>("button.talk-card__title-btn");
      const rect = button?.getBoundingClientRect();
      return {
        id: Number(card.dataset.talkId),
        text: (button?.textContent ?? "").replace(/\s+/g, " ").trim(),
        height: rect ? Math.round(rect.height * 100) / 100 : 0,
        width: rect ? Math.round(rect.width * 100) / 100 : 0,
      };
    }),
  );

  expect(buttons.length).toBe(DAY1_TALKS);

  // Заголовок без размеров = карточка без пути в модалку.
  const visible = buttons.filter((button) => button.width > 0 && button.height > 0);
  expect(visible.length).toBe(DAY1_TALKS);

  for (const button of visible) {
    expect(button.text, `доклад ${button.id}: текст кнопки = название`).toBe(titles.get(button.id));
    expect(button.height, `доклад ${button.id}: сенсорная цель ≥ 44 px`).toBeGreaterThanOrEqual(44);
  }
}

test("01 · / — 39 карточек, 3 таба дней, 11 чипов, счётчик 39, активен первый таб", async ({
  page,
}) => {
  await open(page, "/");

  await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);
  await expect(page.locator("a.day-tab")).toHaveCount(3);
  // 11 чипов трека + отдельный чип «Избранное», который стоит первым и
  // намеренно не несёт `data-track` (см. контракт, «Поведение» п. 4).
  await expect(page.locator("[data-track-chips] > button.track-chip[data-track]")).toHaveCount(11);
  await expect(page.locator(".track-chips button.track-chip").first()).toHaveAttribute(
    "data-fav-filter",
    "",
  );
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

  const chips = page.locator("[data-track-chips] > button.track-chip[data-track]");
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

  // На телефоне (≤ 767.98 px) чипы треков скрыты, и тот же фильтр выбирается
  // нативным списком внутри `label.track-select` (CONTRACT §4).
  await chooseTrack(page, chip, track);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  if (await page.locator("[data-track-select]").isVisible()) {
    await expect(page.locator("[data-track-select]")).toHaveValue(track);
    await expect(page.locator("[data-track-select-value]")).toContainText("·");
  }

  const tracks = await page
    .locator("div.program-grid__talk-cell[data-track]:visible")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.track ?? null));
  expect(tracks.length).toBeGreaterThan(0);
  expect(tracks.every((value) => value === track)).toBe(true);

  const visibleCards = await page.locator("article.talk-card:visible").count();
  expect(visibleCards).toBe(tracks.length);
  await expect(page.locator("[data-talk-count]")).toHaveText(String(visibleCards));
  expect(page.url()).toContain("track=");

  await chooseTrack(page, chip, "");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  if (await page.locator("[data-track-select]").isVisible()) {
    await expect(page.locator("[data-track-select-value]")).toHaveText(/Все треки|All tracks/);
  }
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
    // Число одно на два места — шапку и панель. Строгий локатор без скоупа
    // упал бы на двух совпадениях, поэтому место названо явно.
    await expect(page.locator("#site-nav [data-favorites-count]")).toHaveText("1");
    await expect(page.locator("header.nav-mobile [data-favorites-count]")).toHaveText("1");

    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.locator("button[data-fav][data-talk-id]").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#site-nav [data-favorites-count]")).toHaveText("1");
    await expect(page.locator("header.nav-mobile [data-favorites-count]")).toHaveText("1");
  } finally {
    await page.evaluate(() => window.localStorage.clear());
  }
});

test("07 · модалка: hidden снят, заголовок непустой, body.is-modal-open, Esc и возврат фокуса", async ({
  page,
  browserName,
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

  const focusInside = async (): Promise<boolean> =>
    page.evaluate(() => {
      const dialog = document.querySelector("[data-modal-dialog]");
      return !!dialog && dialog.contains(document.activeElement);
    });

  /**
   * WebKit на macOS повторяет настройку Safari «Tab подсвечивает только поля
   * ввода»: реальное нажатие Tab не доходит ни до кнопок, ни до ссылок
   * (проверено минимальной страницей — из `<button>` Tab уходит только в
   * `<input>`, а без полей фокус остаётся на `body`). Поэтому в WebKit тот же
   * обработчик `keydown` вызывается событием из DOM, а в Chromium-проектах —
   * настоящими нажатиями клавиши. Проверяемое поведение одно и то же.
   */
  const pressTab = async (shift = false): Promise<void> => {
    if (browserName !== "webkit") {
      await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
      return;
    }
    await page.evaluate((withShift) => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: withShift,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, shift);
  };

  // Фокус-трап: Tab не выводит фокус за пределы диалога. Проверяем 12 нажатий —
  // больше, чем интерактивных элементов в модалке, — и каждый раз ждём, что
  // активный элемент остался внутри `[data-modal-dialog]`.
  for (let i = 0; i < 12; i += 1) {
    await pressTab();
    expect(await focusInside()).toBe(true);
  }

  // Границы трапеции проверяем адресно: с последнего элемента Tab уводит на
  // первый, а Shift+Tab с первого — обратно на последний. Это те две ветки, где
  // обработчик обязан вмешаться; «остался внутри» ловит это только косвенно.
  const activeClass = (): Promise<string> =>
    page.evaluate(() => (document.activeElement?.className ?? "").toString());
  const lastSelector = "button[data-modal-fav]";
  const firstSelector = "button.talk-modal__close";

  await page.locator(lastSelector).focus();
  await pressTab();
  expect(await activeClass()).toBe("talk-modal__close");

  await page.locator(firstSelector).focus();
  await pressTab(true);
  expect(await activeClass()).toBe("talk-modal__fav");

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

  test("09 · мобильная модель: один столбец, ни документ, ни сетка не скроллятся вбок", async ({
    page,
  }) => {
    await open(page, "/");

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

    // Сетка перестала быть скроллпортом: вбок скроллить нечего, потому что
    // модель — список, а не сжатая сетка.
    const grid = await page.locator(".program-grid").evaluate((node) => ({
      scrollWidth: (node as HTMLElement).scrollWidth,
      clientWidth: (node as HTMLElement).clientWidth,
    }));
    expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1);

    // Шапка залов не нужна: зал показан бейджем в карточке.
    await expect(page.locator(".program-grid__halls-header")).toBeHidden();
    await expect
      .poll(() =>
        page.locator(".program-grid__halls-header").evaluate((node) => getComputedStyle(node).display),
      )
      .toBe("none");

    // Строки сетки исчезают — контент становится одним столбцом.
    const content = await page.locator(".program-grid__content").evaluate((node) => {
      const style = getComputedStyle(node);
      return { display: style.display, direction: style.flexDirection };
    });
    expect(content).toEqual({ display: "flex", direction: "column" });

    // Все 39 карточек в одном столбце: одинаковый `left` и ширина в экран.
    const cards = await page.locator("article.talk-card").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return { left: Math.round(rect.left), width: Math.round(rect.width) };
      }),
    );
    expect(cards.length).toBe(DAY1_TALKS);
    expect(new Set(cards.map((card) => card.left)).size).toBe(1);
    expect(Math.max(...cards.map((card) => card.width))).toBeLessThanOrEqual(390);

    // Баннер в списке скрыт целиком, но у компактной карточки медиа-блок
    // остаётся: в нём живёт заголовок с кнопкой модалки.
    await expect
      .poll(() =>
        page
          .locator("article.talk-card:not(.talk-card--compact) .talk-card__media")
          .first()
          .evaluate((node) => getComputedStyle(node).display),
      )
      .toBe("none");
    await expect(page.locator(".talk-card--compact .talk-card__media").first()).toBeVisible();
    await expect(page.locator(".talk-card--compact .talk-card__topic-title").first()).toBeVisible();

    // Кнопка заголовка — единственный путь в модалку, поэтому она обязана
    // оставаться кликабельной у всех 39 карточек, включая компактные.
    const titleButtons = await page.locator(".talk-card__title-btn").evaluateAll((nodes) =>
      (nodes as HTMLElement[]).filter((node) => node.getBoundingClientRect().width > 0).length,
    );
    expect(titleButtons).toBe(DAY1_TALKS);

    // Свёрнутая карточка несёт всю координату доклада: время, зал и трек
    // читаются без открытия модалки — колонок сетки в списке больше нет.
    await expect(page.locator(".talk-card__time").first()).toBeVisible();
    await expect(page.locator(".talk-card__hall").first()).toBeVisible();
    await expect(page.locator(".talk-card__track").first()).toBeVisible();

    // Трек ограничен двумя строками: одна обрезала бы имя наполовину.
    expect(
      await page
        .locator(".talk-card__track")
        .first()
        .evaluate((node) => getComputedStyle(node).webkitLineClamp),
    ).toBe("2");
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

    // Тумблеров теперь два: в шапке и в drawer'е. Оба живут одновременно,
    // поэтому адресация — по скоупу, а не `[data-theme-toggle]` целиком:
    // без сужения локатор даёт strict-mode violation на двух элементах.
    await expect(page.locator("[data-theme-toggle]")).toHaveCount(2);

    // Цикл гоняем тумблером В ШАПКЕ: он виден сразу, drawer открывать не нужно
    // (на мобиле меню ещё и перекрывает контент).
    const headerToggle = page.locator(
      "header.nav-mobile .nav-top-actions > button.nav-icon-btn.theme-toggle--header[data-theme-toggle]",
    );
    await expect(headerToggle).toBeVisible();

    await headerToggle.click();
    expect(await theme()).toBe("light");
    expect(await stored()).toBe("light");

    await headerToggle.click();
    expect(await theme()).toBe("cyberpunk");
    expect(await stored()).toBe("cyberpunk");

    await headerToggle.click();
    expect(await theme()).toBe("dark");
    expect(await stored()).toBe("dark");

    // Второй тумблер — в подвале drawer'а: свой скоуп `nav#site-nav`, тот же
    // цикл и то же хранилище. Открываем меню как пользователь, иначе клик
    // уходит в `visibility: hidden` элемент.
    await page.locator("[data-nav-open]").click();
    await expect(page.locator("body")).toHaveClass(/nav-open/);

    const drawerToggle = page.locator(
      "nav#site-nav .drawer-foot button.theme-toggle[data-theme-toggle]",
    );
    await expect(drawerToggle).toBeVisible();

    await drawerToggle.click();
    expect(await theme()).toBe("light");
    expect(await stored()).toBe("light");

    await drawerToggle.click();
    expect(await theme()).toBe("cyberpunk");
    expect(await stored()).toBe("cyberpunk");

    // Первый тумблер не «умер» вместе с открытием меню: оба в DOM и оба видны.
    await expect(headerToggle).toBeVisible();
    await expect(page.locator("[data-theme-toggle]")).toHaveCount(2);
  });

  // Разделитель времени больше НЕ липнет: вторая ступень цепочки — только табы
  // дня. Тест держит обе половины этого решения: разделитель не висит над
  // карточками (уходит вверх при прокрутке), а табы при этом продолжают
  // стоять под шапкой. Без второй половины тест проходил бы и на странице,
  // где сломалась вся липкость.
  test("16 · разделитель времени уезжает при прокрутке, табы дня остаются под шапкой", async ({
    page,
  }) => {
    await open(page, "/");

    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);

    const chain = await page.evaluate(() => {
      const header = document.querySelector("header.nav-mobile")!.getBoundingClientRect();
      const tabs = document.querySelector("nav.day-tabs")!.getBoundingClientRect();
      const times = Array.from(document.querySelectorAll(".program-grid__time-cell"))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => ({
          top: node.getBoundingClientRect().top,
          position: getComputedStyle(node).position,
        }));
      return { headerBottom: header.bottom, tabsBottom: tabs.bottom, times };
    });

    // Табы — по-прежнему липкие, ровно под шапкой.
    expect(chain.tabsBottom).toBeGreaterThan(chain.headerBottom);

    expect(chain.times.length).toBeGreaterThan(1);
    // Ни один разделитель не позиционирован липко…
    for (const time of chain.times) expect(time.position).not.toBe("sticky");

    // …и он едет вместе со страницей: те же ячейки после ещё 100 px прокрутки
    // сместились ровно на 100. Липкая полоса на этом месте осталась бы стоять,
    // поэтому проверка ловит возврат sticky, а не «оказалось выше табов».
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".program-grid__time-cell"))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => ({ text: node.textContent?.trim() ?? "", top: node.getBoundingClientRect().top })),
    );
    await page.evaluate(() => window.scrollTo(0, 1300));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1300);
    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".program-grid__time-cell"))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => ({ text: node.textContent?.trim() ?? "", top: node.getBoundingClientRect().top })),
    );
    const moved = before
      .map((cell) => {
        const match = after.find((next) => next.text === cell.text);
        return match ? Math.round(cell.top - match.top) : null;
      })
      .filter((delta): delta is number => delta !== null && Math.abs(delta) < 500);
    expect(moved.length).toBeGreaterThan(0);
    for (const delta of moved) expect(Math.abs(delta - 100)).toBeLessThanOrEqual(2);
  });

  test("17 · «Избранное» как фильтр: 1 видимая ячейка, счётчик 1, пусто после снятия звезды", async ({
    page,
  }) => {
    await open(page, "/");

    const chip = page.locator("button.track-chip[data-fav-filter]");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-fav-filter-count]")).toHaveText("0");
    await expect(page.locator("article.talk-card:visible")).toHaveCount(DAY1_TALKS);

    const star = page.locator("button[data-fav][data-talk-id]").first();
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-fav-filter-count]")).toHaveText("1");

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article.talk-card:visible")).toHaveCount(1);
    // В режиме списка разделитель — заголовок группы, поэтому пустые группы
    // скрываются вместе с докладами.
    await expect(page.locator(".program-grid__time-cell:visible")).toHaveCount(1);
    await expect(page.locator("[data-talk-count]")).toHaveText("1");
    await expect(page.locator("[data-empty]")).toBeHidden();

    // Снятие звезды при включённом фильтре убирает карточку сразу, без
    // повторного клика по чипу.
    await page.locator("button[data-fav][data-talk-id][aria-pressed='true']").first().click();
    await expect(page.locator("article.talk-card:visible")).toHaveCount(0);
    await expect(page.locator(".program-grid__time-cell:visible")).toHaveCount(0);
    await expect(page.locator("[data-talk-count]")).toHaveText("0");
    await expect(page.locator("[data-empty]")).toBeVisible();
    await expect(page.locator("[data-empty]")).toContainText("В избранном");

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-empty]")).toBeHidden();
    await expect(page.locator("article.talk-card:visible")).toHaveCount(DAY1_TALKS);
  });

  // Два фильтра независимы и складываются по «И»: включение «Избранного» не
  // снимает трек, а выключение возвращает ровно тот набор, что был при треке.
  test("18 · «Избранное» и трек складываются по «И», а не перетирают друг друга", async ({
    page,
  }) => {
    await open(page, "/");

    const chips = page.locator("[data-track-chips] > button.track-chip[data-track]");
    let index = -1;
    let track = "";
    for (let i = 0; i < (await chips.count()); i += 1) {
      const count = Number((await chips.nth(i).locator(".track-chip__count").innerText()).trim());
      if (count > 0) {
        index = i;
        track = (await chips.nth(i).getAttribute("data-track")) ?? "";
        break;
      }
    }
    expect(index, "в первый день должен найтись трек хотя бы с одним докладом").toBeGreaterThanOrEqual(0);

    const trackChip = chips.nth(index);
    await chooseTrack(page, trackChip, track);
    await expect(trackChip).toHaveAttribute("aria-pressed", "true");

    const trackOnly = await page.locator("article.talk-card:visible").count();
    expect(trackOnly, "трек должен оставлять больше одной карточки, иначе «И» не отличить от «ИЛИ»").toBeGreaterThan(1);
    await expect(page.locator("[data-talk-count]")).toHaveText(String(trackOnly));

    // Звезда на карточке выбранного трека: при включённом «Избранном» набор
    // сузится до неё, а не обнулится и не расширится до всего дня.
    await page
      .locator(`div.program-grid__talk-cell[data-track="${track}"] article.talk-card:visible`)
      .first()
      .locator("button[data-fav]")
      .click();

    const favChip = page.locator("button.track-chip[data-fav-filter]");
    await favChip.click();
    await expect(favChip).toHaveAttribute("aria-pressed", "true");
    await expect(trackChip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article.talk-card:visible")).toHaveCount(1);
    await expect(page.locator("[data-talk-count]")).toHaveText("1");

    await favChip.click();
    await expect(favChip).toHaveAttribute("aria-pressed", "false");
    await expect(trackChip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article.talk-card:visible")).toHaveCount(trackOnly);
    await expect(page.locator("[data-talk-count]")).toHaveText(String(trackOnly));
    expect(page.url()).toContain("track=");
  });

  // Крестик модалки — `position: sticky` внутри прокручиваемого диалога:
  // на длинном описании он обязан остаться у верхнего края, а не уехать с
  // контентом (раньше `absolute` уезжал вместе с прокруткой).
  test("21 · крестик модалки sticky: виден после прокрутки длинного описания", async ({
    page,
    request,
  }) => {
    await open(page, "/");

    // Самый длинный доклад дня — из того же `/program.json`, что читает клиент:
    // диалог гарантированно прокручивается, без выдуманных данных.
    const body = (await (await request.get(BASE + "/program.json")).json()) as {
      talks: { id: number; description: string; short: string }[];
    };
    const ids = new Set(await talkIds(page));
    const longest = body.talks
      .filter((talk) => ids.has(Number(talk.id)))
      .sort(
        (a, b) =>
          (b.description || b.short).length - (a.description || a.short).length,
      )[0];
    expect(longest, "в списке дня должен быть хотя бы один доклад").toBeTruthy();

    await page
      .locator(`article.talk-card[data-talk-id="${longest.id}"] button.talk-card__title-btn`)
      .click();
    await expect.poll(() => isHidden(page, "[data-modal]")).toBe(false);

    const close = page.locator("button.talk-modal__close[data-modal-close]");
    await expect(close).toBeVisible();
    await expect
      .poll(() => close.evaluate((node) => getComputedStyle(node).position))
      .toBe("sticky");

    const dialog = page.locator("[data-modal-dialog]");
    const before = await dialog.evaluate((node) => {
      const el = node as HTMLElement;
      const close = document.querySelector("button[data-modal-close]") as HTMLElement;
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        closeTop: close.getBoundingClientRect().top,
      };
    });
    expect(
      before.scrollHeight,
      "длинное описание должно давать прокрутку диалога",
    ).toBeGreaterThan(before.clientHeight + 40);

    // Прокручиваем сам диалог (не страницу): sticky-крестик не уезжает.
    await dialog.evaluate((node) => {
      const el = node as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => dialog.evaluate((node) => (node as HTMLElement).scrollTop))
      .toBeGreaterThan(100);

    const after = await close.evaluate((node) => {
      const el = document.querySelector("[data-modal-dialog]") as HTMLElement;
      const dialogRect = el.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return {
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        top: rect.top,
        bottom: rect.bottom,
      };
    });

    // Кнопка в границах диалога и у его верхнего края. Смещение — паддинг
    // диалога (16 px в списке, 20 px в сетке) плюс `inset-block-start: 12px`,
    // то есть до 48 px, а не высота прокрученного текста.
    expect(after.top).toBeGreaterThanOrEqual(after.dialogTop);
    expect(after.bottom).toBeLessThanOrEqual(after.dialogBottom + 1);
    expect(after.top - after.dialogTop).toBeLessThanOrEqual(48);
    // И сама кнопка осталась примерно там же, где была до прокрутки: она
    // прилипла к краю, а не уехала вместе с контентом.
    expect(Math.abs(after.top - before.closeTop)).toBeLessThanOrEqual(24);
  });

  // Модалка и drawer живут в истории отдельной записью: системная «Назад»
  // обязана закрыть слой, а не выкинуть пользователя со страницы.
  test("22 · системная «Назад» закрывает модалку, а не уводит со страницы", async ({ page }) => {
    await open(page, "/");

    await page.locator("button.talk-card__title-btn").first().click();
    await expect.poll(() => isHidden(page, "[data-modal]")).toBe(false);
    await expect(page.locator("body")).toHaveClass(/is-modal-open/);

    await page.goBack();

    await expect.poll(() => isHidden(page, "[data-modal]")).toBe(true);
    await expect(page.locator("body")).not.toHaveClass(/is-modal-open/);
    // Остались на той же программе: ни about:blank, ни второго дня.
    expect(new URL(page.url()).pathname).toBe(`${BASE}/`);
    await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);
  });

  // `prefers-reduced-motion: reduce` должен снять и появление модалки:
  // анимация — украшение, а не условие появления диалога.
  test("25 · prefers-reduced-motion: reduce отключает анимации модалки", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/");

    await page.locator("button.talk-card__title-btn").first().click();
    await expect.poll(() => isHidden(page, "[data-modal]")).toBe(false);

    const styles = await page.evaluate(() => {
      const read = (selector: string): { name: string; duration: string } | null => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: style.animationDuration };
      };
      return { modal: read(".talk-modal"), dialog: read(".talk-modal__dialog") };
    });

    expect(styles.modal, "контейнер модалки должен существовать").not.toBeNull();
    expect(styles.dialog, "диалог модалки должен существовать").not.toBeNull();

    // Главный признак — `animation-name: none` из `program.css` (блок
    // `prefers-reduced-motion`): анимации появления у обоих слоёв нет вовсе.
    expect(styles.modal?.name).toBe("none");
    expect(styles.dialog?.name).toBe("none");

    // Длительность сверяем числом, а не строкой: `tokens.css` глобально
    // ставит `animation-duration: 0.01ms !important` (1e-05s), а движки
    // печатают эту величину по-разному («0s», «1e-05s», «0.00001s»).
    const toMs = (value: string): number =>
      value.trim().endsWith("ms")
        ? Number.parseFloat(value)
        : Number.parseFloat(value) * 1000;
    expect(toMs(styles.modal?.duration ?? "")).toBeLessThanOrEqual(1);
    expect(toMs(styles.dialog?.duration ?? "")).toBeLessThanOrEqual(1);
  });

  test("26 · кнопка-заголовок в списке: текст = название доклада, высота ≥ 44 px", async ({
    page,
    request,
  }) => {
    await open(page, "/");
    await assertTitleButtons(page, request);
  });

  // Без JS список читается целиком: модель списка включает CSS, а карточки и
  // заголовки уже в HTML. Проверяем именно мобильную ширину — там карточка
  // без баннера держит заголовок в `.talk-card__media`, а не в нижнем блоке.
  test.describe("без JavaScript на 390", () => {
    test.use({ javaScriptEnabled: false });

    test("23 · без JS: карточки и заголовки видны на 390 px, скролла вбок нет", async ({
      page,
    }) => {
      await open(page, "/");

      await expect(page.locator("article.talk-card")).toHaveCount(DAY1_TALKS);
      await expect(page.locator("h1.page-title")).toBeVisible();
      await expect(page.locator("a.day-tab")).toHaveCount(3);

      const titles = page.locator(".talk-card__title-btn");
      await expect(titles).toHaveCount(DAY1_TALKS);
      await expect(titles.first()).toBeVisible();
      expect((await titles.first().innerText()).trim().length).toBeGreaterThan(0);

      // Список — работа CSS: одна колонка и ни одного пикселя вбок.
      const layout = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        contentDisplay: getComputedStyle(
          document.querySelector(".program-grid__content") as HTMLElement,
        ).display,
        firstCard: document
          .querySelector("article.talk-card")
          ?.getBoundingClientRect().width,
      }));
      expect(layout.overflowX).toBe(0);
      expect(layout.contentDisplay).toBe("flex");
      expect(layout.firstCard).toBeLessThanOrEqual(390);
    });
  });
});

// 320 px — нижняя граница бюджета: на ней три вкладки дней обязаны встать в
// строку без горизонтальной прокрутки, а липкая цепочка — не разъехаться.
test.describe("мобильный 320×700", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("20 · три вкладки дней достижимы и не переполняют строку на 320 px", async ({ page }) => {
    await open(page, "/");

    const doc = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(doc, "документ не должен скроллиться вбок на 320 px").toBe(0);

    await expect(page.locator("nav.day-tabs a.day-tab")).toHaveCount(3);

    // Полоса табов — не скроллпорт: содержимое встаёт по её ширине.
    const strip = await page.locator("nav.day-tabs").evaluate((node) => {
      const el = node as HTMLElement;
      return { overflow: el.scrollWidth - el.clientWidth };
    });
    expect(strip.overflow, "переполнение .day-tabs должно быть 0").toBe(0);

    // Каждая вкладка внутри видимой полосы: третья не за краем.
    const tabs = await page.evaluate(() => {
      const nav = document.querySelector("nav.day-tabs") as HTMLElement;
      const navRect = nav.getBoundingClientRect();
      return Array.from(nav.querySelectorAll("a.day-tab")).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          navLeft: navRect.left,
          navRight: navRect.right,
        };
      });
    });

    expect(tabs.length).toBe(3);
    for (const [index, tab] of tabs.entries()) {
      expect(tab.width, `вкладка ${index + 1} должна иметь ширину`).toBeGreaterThan(0);
      expect(tab.left, `вкладка ${index + 1} не должна съезжать влево`).toBeGreaterThanOrEqual(
        tab.navLeft - 1,
      );
      expect(tab.right, `вкладка ${index + 1} не должна уезжать за правый край`).toBeLessThanOrEqual(
        tab.navRight + 1,
      );
    }

    for (let i = 0; i < 3; i += 1) {
      await expect(page.locator("a.day-tab").nth(i)).toBeVisible();
    }
  });

  test("24 · липкая цепочка держится при scrollY = 0 и на 320 px", async ({ page }) => {
    await open(page, "/");

    // На старте шапка и табы стоят в потоке: табы начинаются под шапкой.
    const top = await page.evaluate(() => {
      const header = document.querySelector("header.nav-mobile")!.getBoundingClientRect();
      const tabs = document.querySelector("nav.day-tabs")!.getBoundingClientRect();
      return { headerBottom: header.bottom, tabsTop: tabs.top };
    });
    expect(top.tabsTop).toBeGreaterThanOrEqual(top.headerBottom - 1);

    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);

    const chain = await page.evaluate(() => {
      const header = document.querySelector("header.nav-mobile")!.getBoundingClientRect();
      const tabs = document.querySelector("nav.day-tabs")!.getBoundingClientRect();
      const times = Array.from(document.querySelectorAll(".program-grid__time-cell"))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => ({
          top: node.getBoundingClientRect().top,
          position: getComputedStyle(node).position,
        }));
      return { headerBottom: header.bottom, tabsTop: tabs.top, tabsBottom: tabs.bottom, times };
    });

    // Табы прилипли ровно под шапкой — без зазора и без перекрытия.
    expect(chain.tabsTop).toBeGreaterThanOrEqual(chain.headerBottom - 1);
    expect(chain.tabsTop).toBeLessThanOrEqual(chain.headerBottom + 2);

    // Разделителя в цепочке нет: он не липкий и ушёл выше табов.
    expect(chain.times.length).toBeGreaterThan(1);
    for (const time of chain.times) expect(time.position).not.toBe("sticky");
    expect(Math.min(...chain.times.map((time) => time.top))).toBeLessThan(chain.tabsBottom);
  });
});

test("12 · /program.json — 200, application/json, 91 доклад, 3 дня", async ({ request }) => {
  const response = await request.get(BASE + "/program.json");
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
    await expect(page.locator("[data-track-chips] > button.track-chip[data-track]")).toHaveCount(11);
    await expect(page.locator("button.track-chip[data-fav-filter]")).toHaveCount(1);
    await expect(page.locator("[data-talk-count]")).toHaveText(String(DAY1_TALKS));
  });
});

// Регрессия: на десктопе тумблер меню был `display: none` (базовое правило
// `site.css`), а сам drawer — единственный путь к смене темы и к дням. Значит
// при ≥1024 px тема и навигация становились недостижимы мышью и клавиатурой.
// Сейчас тумблер темы есть ещё и в шапке — он работает без открытия меню.
test.describe("десктоп 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("14 · тумблер темы в шапке достижим без меню, drawer открывается тумблером меню", async ({
    page,
  }) => {
    await open(page, "/");

    // Шапка: тумблер темы виден и меняет тему, не открывая drawer.
    const themeToggle = page.locator("header.nav-mobile .nav-top-actions [data-theme-toggle]");
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Навигация по-прежнему за тумблером меню — он тоже виден на десктопе.
    const toggle = page.locator("[data-nav-open]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator("body")).toHaveClass(/nav-open/);

    // Тумблер темы внутри drawer'а тоже рабочий: свой скоуп `nav#site-nav`.
    const drawerToggle = page.locator("nav#site-nav [data-theme-toggle]");
    await expect(drawerToggle).toBeVisible();
    await drawerToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "cyberpunk");
  });

  // Мобильная модель (список) не должна протекать на десктоп: там по-прежнему
  // сетка залов с колонкой времени.
  test("19 · десктопная сетка не сломана мобильной моделью", async ({ page }) => {
    await open(page, "/");

    await expect
      .poll(() =>
        page.locator(".program-grid__halls-header").evaluate((node) => getComputedStyle(node).display),
      )
      .toBe("grid");
    await expect
      .poll(() =>
        page.locator(".talk-card__hall").first().evaluate((node) => getComputedStyle(node).display),
      )
      .toBe("none");
    await expect
      .poll(() =>
        page.locator(".talk-card__track").first().evaluate((node) => getComputedStyle(node).display),
      )
      .toBe("none");
    await expect
      .poll(() =>
        page.locator("nav.day-tabs").evaluate((node) => getComputedStyle(node).position),
      )
      .toBe("static");

    const grid = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("article.talk-card")).map((node) =>
        Math.round(node.getBoundingClientRect().width),
      );
      const lefts = new Set(
        Array.from(document.querySelectorAll("article.talk-card")).map((node) =>
          Math.round(node.getBoundingClientRect().left),
        ),
      );
      return { cardWidth: cards[0], columns: lefts.size };
    });

    // Ширина карточки и число колонок — измеренные координаты сетки:
    // 5 залов первого дня встают в 5 колонок, карточка 391 px.
    expect(grid.cardWidth).toBe(391);
    expect(grid.columns).toBe(5);
  });

  // В сетке заголовок тоже кнопка: высота ≥ 44 px обязана держаться и там,
  // где карточка шире и заголовок может встать в одну строку.
  test("27 · кнопка-заголовок в десктопной сетке: текст = название, высота ≥ 44 px", async ({
    page,
    request,
  }) => {
    await open(page, "/");
    await assertTitleButtons(page, request);
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

// Соцсети: overlay мерджится в `PROGRAM` и уезжает в `/program.json`, поэтому
// тест берёт настоящую пару «спикер + ссылка» из данных, а не хардкодит имя —
// иначе удаление одной ссылки ломало бы тест без регрессии.
test("28 · соцсети спикера: иконка в карточке и в модалке, внешние атрибуты", async ({
  page,
  request,
}) => {
  const response = await request.get(BASE + "/program.json");
  const body = (await response.json()) as {
    days: { id: number; order: number }[];
    talks: {
      id: number;
      dayId: number;
      lectors: { name: string; socials?: { network: string; url: string }[] }[];
    }[];
  };

  const withLinks = (talk: (typeof body.talks)[number]) =>
    talk.lectors.filter((lector) => (lector.socials ?? []).length > 0);
  const talk = body.talks.find((item) => withLinks(item).length > 0);
  expect(talk).toBeTruthy();
  if (!talk) return;

  const lector = withLinks(talk)[0]!;
  const first = lector.socials![0]!;
  const day = body.days.find((item) => item.id === talk.dayId)!;
  await open(page, day.order === 0 ? "/" : `/day/${day.order + 1}/`);

  const card = page.locator(`article.talk-card[data-talk-id="${talk.id}"]`);
  const link = card.locator(`a.social-link[aria-label$="${lector.name}"]`).first();
  await expect(link).toHaveAttribute("href", first.url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener noreferrer nofollow/);
  await expect(link).toHaveAttribute(
    "aria-label",
    new RegExp(lector.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );

  const mask = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.maskImage !== "none"
      ? style.maskImage
      : style.getPropertyValue("-webkit-mask-image");
  });
  expect(mask).toContain("data:image/svg+xml");

  const emptyTalk = body.talks.find(
    (item) => item.dayId === talk.dayId && item.lectors.length > 0 && withLinks(item).length === 0,
  );
  if (emptyTalk) {
    await expect(
      page.locator(`article.talk-card[data-talk-id="${emptyTalk.id}"] .social-links`),
    ).toHaveCount(0);
  }

  await card.locator("[data-talk-open]").first().click();
  await expect(page.locator("[data-modal-speakers] a.social-link").first()).toHaveAttribute(
    "href",
    first.url,
  );
});

// «Избранное» в шапке. Проверяется то, что ломается молча: звезда есть, но не
// на виду (шапка узкая), число в шапке отстаёт от числа в панели, а нажатие не
// переключает `aria-pressed` — тогда вид кнопки и состояние фильтра расходятся,
// и повторный клик читается как «ничего не произошло».
test("29 · «Избранное» в шапке: видно, число общее с панелью, клик переключает фильтр", async ({
  page,
}) => {
  await open(page, "/");

  const header = page.locator("header.nav-mobile button[data-fav-header]");
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("aria-pressed", "false");
  await expect(header.locator("[data-favorites-count]")).toHaveText("0");
  // Имя складывается из скрытой подписи и числа: без подписи скринридер
  // услышал бы голое «0».
  await expect(header).toHaveAccessibleName(/Избранное/);

  // Одна звезда в карточке — оба счётчика. Это и есть «одно число, два места».
  await page.locator("button[data-fav][data-talk-id]").first().click();
  await expect(header.locator("[data-favorites-count]")).toHaveText("1");
  await expect(page.locator("#site-nav [data-favorites-count]")).toHaveText("1");

  // Клик по шапке включает тот же фильтр, что чип: список и счётчик докладов.
  await header.click();
  await expect(header).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("article.talk-card:visible")).toHaveCount(1);
  await expect(page.locator("button.track-chip[data-fav-filter]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // И выключает: это переключатель, а не «показать».
  await header.click();
  await expect(header).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("article.talk-card:visible")).toHaveCount(DAY1_TALKS);
  await expect(page.locator("button.track-chip[data-fav-filter]")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Состояние фильтра живёт в sessionStorage: после перезагрузки вид кнопки
  // обязан прийти из него, а не из разметки (там всегда `false`).
  await header.click();
  await page.reload();
  await page.waitForLoadState("load");
  await expect(page.locator("header.nav-mobile button[data-fav-header]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("article.talk-card:visible")).toHaveCount(1);
});

// «Все треки» в шапке — раскрывающийся список из 12 пунктов (сброс + 11 треков).
// Первая версия кнопки только снимала фильтр, и при полном списке клик не делал
// ничего: со стороны это «кнопка не работает». Тест держит четыре вещи, которые
// ломаются молча: меню не открывается, выбор не доходит до чипов и URL, панель не
// закрывается по Esc/клику мимо, и кнопки нет на телефоне.
test("30 · «Все треки» в шапке: меню из 12 пунктов, синхронно с чипами и URL", async ({
  page,
}) => {
  await open(page, "/");

  const trigger = page.locator("header.nav-mobile button[data-track-header]");
  const panel = page.locator("[data-track-menu]");
  const options = panel.locator("button[data-track-option]");
  const allOption = panel.locator('button[data-track-option][data-track=""]');

  // Кнопка есть на любой ширине, включая 320 px.
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(12);
  // Без фильтра нажат сброс — ровно как у чипов.
  await expect(allOption).toHaveAttribute("aria-pressed", "true");
  await expect(trigger).toHaveAttribute("data-active", "false");

  // Выбор трека из меню фильтрует так же, как чип: список, URL, чип, кнопка.
  const option = page.locator('button[data-track-option]:not([data-track=""])').first();
  const track = await option.getAttribute("data-track");
  expect(track).toBeTruthy();
  await option.click();
  await expect(panel).toBeHidden();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await expect(allOption).toHaveAttribute("aria-pressed", "false");
  await expect(trigger).toHaveAttribute("data-active", "true");
  expect(page.url()).toContain("track=");
  await expect(page.locator('button.track-chip[data-track][aria-pressed="true"]')).toHaveCount(1);
  const visibleCells = await page.locator("article.talk-card:visible").count();
  expect(visibleCells).toBeLessThan(DAY1_TALKS);
  expect(visibleCells).toBeGreaterThan(0);

  // Esc закрывает панель и возвращает фокус на кнопку.
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // Клик мимо — тоже закрывает. Точка в левом нижнем углу вьюпорта: на 390 px
  // панель занимает почти всю верхнюю половину, и «клик по заголовку» попадал
  // в саму панель (поймано в WebKit, где перехват идёт иначе, чем в Chromium).
  await trigger.click();
  await expect(panel).toBeVisible();
  const viewport = page.viewportSize()!;
  const urlBefore = page.url();
  await page.mouse.click(4, viewport.height - 4);
  await expect(panel).toBeHidden();
  expect(page.url()).toBe(urlBefore);

  // Сброс из меню возвращает весь день и чистит URL.
  await trigger.click();
  await allOption.click();
  await expect(page.locator("article.talk-card:visible")).toHaveCount(DAY1_TALKS);
  expect(page.url()).not.toContain("track=");
  await expect(trigger).toHaveAttribute("data-active", "false");

  // Состояние из `?track=` приезжает из URL: разметка отдаёт «Все треки»
  // нажатой, и только клиент знает про query — он и обязан переписать меню.
  await open(page, `/?track=${encodeURIComponent(track!)}`);
  await expect(page.locator("header.nav-mobile button[data-track-header]")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.locator("header.nav-mobile button[data-track-header]").click();
  await expect(page.locator(`button[data-track-option][data-track="${track}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

