/**
 * Заметка доклада в собранной странице: `/talk/<id>/` и `/en/talk/<id>/`.
 *
 * Проверяется то, чего не видно в юнит-тестах: маршрут реально собран, факты
 * страницы совпадают со слепком, связь «Связанные» ведёт на существующие
 * адреса, переключатель языка остаётся на том же докладе, а модалка даёт вход.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

const BASE = "/mm-program-page";
const ID = 309;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState("load");
}

/** Заметки читаются с диска: ожидание для «своей локали» берётся из файла. */
const NOTES = {
  ru: join(process.cwd(), "src", "content", "talks"),
  en: join(process.cwd(), "src", "content", "talks-en"),
} as const;

/** Тело `.md`: всё после закрывающей пары `---` (тот же контракт, что `splitNote`). */
function noteBody(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return "";
  const end = text.indexOf("\n---\n", 3);
  return end === -1 ? "" : text.slice(end + "\n---\n".length);
}

/**
 * Канонизация текста: типографика Astro/markdown превращает `'` в `’`, `"` в
 * `“…”`, `--` в `–`. Ожидание из файла и текст из DOM обязаны сравниваться в
 * одной форме, иначе тест ловит рендер кавычек, а не локаль.
 */
function canonical(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Первый «чистый» абзац тела: нормализованные пробелы, без markdown-разметки,
 * чтобы ожидание совпало с текстом, а не с исходной разметкой. Длинный абзац
 * делает проверку устойчивой к случайному совпадению.
 */
function firstPlainParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const paragraph = canonical(block);
    if (paragraph.length >= 80 && !/[*_`#>\[\]|]/.test(paragraph)) return paragraph;
  }
  return "";
}

/** Нормализация текста, прочитанного из DOM. */
function normalize(text: string): string {
  return canonical(text);
}

/**
 * Самый длинный доклад, у которого в обеих локалях есть длинный чистый абзац
 * и эти абзацы не являются подстроками друг друга. Выбор динамический: тест не
 * запрещает опустошить конкретную заметку.
 */
function pickLocalizedNote(): { id: number; ru: string; en: string } {
  const ids = readdirSync(NOTES.ru)
    .filter((name) => name.endsWith(".md"))
    .map((name) => Number(name.slice(0, -".md".length)));
  let best: { id: number; ru: string; en: string } | null = null;
  for (const id of ids) {
    const ru = firstPlainParagraph(noteBody(readFileSync(join(NOTES.ru, `${id}.md`), "utf8")));
    const en = firstPlainParagraph(noteBody(readFileSync(join(NOTES.en, `${id}.md`), "utf8")));
    if (!ru || !en || ru.includes(en) || en.includes(ru)) continue;
    if (!best || ru.length + en.length > best.ru.length + best.en.length) best = { id, ru, en };
  }
  if (!best) throw new Error("нет доклада с длинными телами в обеих локалях");
  return best;
}

test.beforeEach(async ({ context }) => {
  // Всё внешнее (CDN картинок, PostHog) — в оффлайн: тест про разметку, не про сеть.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4321") return route.continue();
    return route.abort();
  });
});

test("русская заметка: адрес, заголовок и пара языков", async ({ page }) => {
  const response = await page.goto(`${BASE}/talk/${ID}/`);
  expect(response?.status()).toBe(200);
  const program = await (await page.request.get(`${BASE}/program.json`)).json();
  const talk = program.talks.find((item: { id: number }) => item.id === ID);
  await expect(page.locator("h1")).toHaveText(talk.title);
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", new RegExp(`/en/talk/${ID}/$`));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/talk/${ID}/$`));
});

test("факты доклада на странице: день, время, зал", async ({ page }) => {
  await open(page, `/talk/${ID}/`);
  const eyebrow = page.locator(".talk-note__eyebrow");
  await expect(eyebrow).toContainText(/\d{2}:\d{2}–\d{2}:\d{2}/);
  await expect(eyebrow).toContainText("Архангельск");
});

test("связанные доклады ведут на собранные страницы", async ({ page }) => {
  await open(page, `/talk/${ID}/`);
  const links = page.locator(".talk-note__related-list a");
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(await (await page.request.get(href)).status()).toBe(200);
  }
});

test("английская пара и переключатель остаются на докладе", async ({ page }) => {
  await open(page, `/en/talk/${ID}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".nav-lang").first()).toHaveAttribute("href", new RegExp(`/talk/${ID}/$`));
});

test("модалка даёт ссылку на постоянную страницу доклада", async ({ page }) => {
  await open(page, "/");
  await page.locator("button.talk-card__title-btn").first().click();
  const link = page.locator("[data-modal-page]");
  await expect(link).toBeVisible();
  const id = await page.locator("[data-modal-dialog]").getAttribute("data-talk-id");
  expect(id).toBeTruthy();
  await expect(link).toHaveAttribute("href", new RegExp(`/talk/${id}/$`));
});

test("тело заметки рендерится из своей локали", async ({ page }) => {
  const note = pickLocalizedNote();

  await open(page, `/talk/${note.id}/`);
  const ruProse = normalize(await page.locator(".talk-note__prose").innerText());
  expect(ruProse, `RU-страница ${note.id} не содержит свой абзац`).toContain(note.ru);
  expect(ruProse, `RU-страница ${note.id} содержит английский абзац`).not.toContain(note.en);

  await open(page, `/en/talk/${note.id}/`);
  const enProse = normalize(await page.locator(".talk-note__prose").innerText());
  expect(enProse, `EN-страница ${note.id} не содержит свой абзац`).toContain(note.en);
  expect(enProse, `EN-страница ${note.id} содержит русский абзац`).not.toContain(note.ru);
});

test("на /en/talk/<id>/ заголовки связанных докладов английские — из /en/program.json", async ({ page }) => {
  await open(page, `/en/talk/${ID}/`);
  const links = page.locator(".talk-note__related-list a");
  await expect(links.first()).toBeVisible();
  await expect(page.locator("#talk-note-related")).toHaveText("Related");

  const program = await (await page.request.get(`${BASE}/en/program.json`)).json();
  const titles = new Map<number, string>(
    program.talks.map((talk: { id: number; title: string }) => [talk.id, talk.title] as const),
  );
  const items = await links.evaluateAll((nodes) =>
    nodes.map((node) => ({ text: (node.textContent ?? "").trim(), href: node.getAttribute("href") ?? "" })),
  );
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    const match = item.href.match(/\/en\/talk\/(\d+)\/$/);
    expect(match, `ссылка ${item.href} не ведёт на английскую страницу доклада`).not.toBeNull();
    const expected = titles.get(Number(match![1]));
    expect(expected, `в /en/program.json нет доклада ${match![1]}`).toBeDefined();
    expect(item.text, `заголовок связанного доклада ${match![1]} не совпал со слепком`).toBe(expected!);
  }
});

test("пустое тело не рендерит секцию «О докладе», непустое — рендерит", async ({ page }) => {
  for (const id of [267, 292, 361, 362]) {
    for (const path of [`/talk/${id}/`, `/en/talk/${id}/`]) {
      await open(page, path);
      expect(await page.locator(".talk-note__about").count(), `${path}: секция пустого тела`).toBe(0);
    }
  }
  for (const path of [`/talk/${ID}/`, `/en/talk/${ID}/`]) {
    await open(page, path);
    await expect(page.locator(".talk-note__about")).toBeVisible();
    expect(normalize(await page.locator(".talk-note__prose").innerText()).length).toBeGreaterThan(0);
  }
});

test("несуществующий доклад → 404", async ({ page }) => {
  const response = await page.goto(`${BASE}/talk/999999/`);
  expect(response?.status()).toBe(404);
  await expect(page.locator(".talk-note")).toHaveCount(0);
});

test("«← К расписанию» ведёт на страницу дня с якорем доклада", async ({ page }) => {
  await open(page, `/talk/${ID}/`);
  const back = page.locator("a.talk-note__back");
  await expect(back).toBeVisible();
  const href = await back.getAttribute("href");
  expect(href, "у обратной ссылки нет href").toBeTruthy();
  const match = href!.match(/\/day\/(\d+)\/#t(\d+)$/);
  expect(match, `обратная ссылка ведёт не на день с якорем: ${href}`).not.toBeNull();
  expect(Number(match![2])).toBe(ID);

  expect((await page.request.get(href!)).status()).toBe(200);
  await page.goto(href!);
  await page.waitForLoadState("load");
  await expect(page.locator(`#t${ID}`)).toHaveCount(1);
});

const DIST = join(process.cwd(), "dist");

function metaDescription(html: string): string | null {
  const match = html.match(/<meta name="description" content="([^"]*)"/);
  return match ? match[1] : null;
}

test("описание на всех собранных страницах доклада: без висячих запятых", () => {
  const notes = readdirSync(join(DIST, "talk")).filter((name) => /^\d+$/.test(name));
  expect(notes.length, "в dist нет страниц докладов").toBeGreaterThan(0);

  for (const id of notes) {
    for (const path of [`talk/${id}`, `en/talk/${id}`]) {
      const html = readFileSync(join(DIST, path, "index.html"), "utf8");
      const description = metaDescription(html);
      // 27 из 91 доклада приходят без трека: сегмент выпадает целиком, а не
      // оставляет `— ,` в начале перечисления.
      expect(description, `${path}: нет <meta name="description">`).toBeTruthy();
      expect(description, `${path}: пустой сегмент в описании`).not.toMatch(/—\s*,|,\s*,|,\s*\.$/);
      expect(html, `${path}: пустой абзац трека`).not.toContain('class="talk-note__track"></p>');
    }
  }
});

test("title и og:title: h1 плюс название события, кавычки не съедены", async ({ page }) => {
  const cases = [
    { path: `/talk/279/`, brand: "Матемаркетинг 2026" },
    { path: `/en/talk/${ID}/`, brand: "Matemarketing 2026" },
  ] as const;

  for (const { path, brand } of cases) {
    await open(page, path);
    const h1 = (await page.locator("h1").innerText()).trim();
    const title = await page.title();
    expect(title, `${path}: <title> не собран из h1`).toBe(`${h1} — ${brand}`);
    await expect(page.locator('meta[property="og:title"]'), `${path}: og:title`).toHaveAttribute(
      "content",
      title,
    );
  }

  // У 279 в названии кавычка: `"флайтовой"` в данных не должно превратиться в
  // пустое место или в сущность в выдаче.
  await open(page, "/talk/279/");
  expect(await page.title()).toContain('"флайтовой"');
});

test("hreflang на обеих версиях заметки: ru, en и x-default", async ({ page }) => {
  for (const path of [`/talk/${ID}/`, `/en/talk/${ID}/`]) {
    await open(page, path);
    const links = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          lang: node.getAttribute("hreflang") ?? "",
          href: node.getAttribute("href") ?? "",
        })),
      );
    const byLang = new Map(links.map((item) => [item.lang, item.href] as const));
    expect([...byLang.keys()].sort(), `${path}: набор hreflang`).toEqual(["en", "ru", "x-default"]);
    expect(byLang.get("ru"), `${path}: ru`).toMatch(new RegExp(`/talk/${ID}/$`));
    expect(byLang.get("en"), `${path}: en`).toMatch(new RegExp(`/en/talk/${ID}/$`));
    expect(byLang.get("x-default"), `${path}: x-default`).toMatch(new RegExp(`/talk/${ID}/$`));
  }
});

test("английская заметка: eyebrow без кириллицы, h1 из /en/program.json, обратная ссылка в английский день", async ({
  page,
}) => {
  await open(page, `/en/talk/${ID}/`);

  const eyebrow = page.locator(".talk-note__eyebrow");
  expect(await eyebrow.innerText(), "EN-eyebrow содержит кириллицу").not.toMatch(/[А-Яа-яЁё]/);
  // «Hall:» — visually-hidden подпись для скринридера, поэтому `innerText` её не
  // видит, а `textContent` видит.
  expect(await eyebrow.textContent(), "EN-eyebrow без подписи зала").toContain("Hall:");

  const program = await (await page.request.get(`${BASE}/en/program.json`)).json();
  const talk = program.talks.find((item: { id: number }) => item.id === ID);
  await expect(page.locator("h1")).toHaveText(talk.title);

  const href = await page.locator("a.talk-note__back").getAttribute("href");
  expect(href, "у обратной ссылки нет href").toBeTruthy();
  expect(href, `EN-обратная ссылка ведёт не в английский день: ${href}`).toMatch(
    new RegExp(`/en/day/\\d+/#t${ID}$`),
  );
  expect((await page.request.get(href!)).status()).toBe(200);
  await page.goto(href!);
  await page.waitForLoadState("load");
  await expect(page.locator(`#t${ID}`)).toHaveCount(1);
});

test("sitemap: адреса заметок собраны, мусора нет", async ({ page }) => {
  const indexResponse = await page.request.get(`${BASE}/sitemap-index.xml`);
  expect(indexResponse.status()).toBe(200);
  const nested = (await indexResponse.text()).match(/<loc>([^<]*sitemap-[^<]*)<\/loc>/);
  expect(nested, "в sitemap-index нет ссылки на карту").not.toBeNull();

  const map = await (await page.request.get(new URL(nested![1]).pathname)).text();
  const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locs.length, "sitemap пуст").toBeGreaterThan(0);

  const program = await (await page.request.get(`${BASE}/program.json`)).json();
  const talkUrls = locs.filter((loc) => /\/(?:en\/)?talk\/\d+\/$/.test(loc));
  expect(talkUrls.length, "в sitemap не все заметки докладов по обеим локалям").toBe(
    program.talks.length * 2,
  );
  expect(locs.some((loc) => /404\.html$|\.json$/.test(loc)), "в sitemap служебный адрес").toBe(false);
});

test.describe("мобильный 320×700: страница доклада", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("вбок не скроллится, язык и меню доступны из drawer'а", async ({ page }) => {
    for (const path of [`/talk/${ID}/`, `/en/talk/${ID}/`]) {
      await open(page, path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path}: документ скроллится вбок на 320 px`).toBe(0);

      await page.locator("[data-nav-open]").click();
      await expect(page.locator("#site-nav a.nav-lang")).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });
});
