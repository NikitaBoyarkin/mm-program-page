/**
 * SEO-слой собранных заметок доклада: meta description, `<title>`/og:title,
 * hreflang и sitemap.
 *
 * Отдельный файл, а не секция `talk-pages.spec.ts`: тот держит поведение
 * страницы (факты, связанные, тело, мобильный вид) и уже упёрся в бюджет
 * размера файла. Здесь — только то, что читают поисковики.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

const BASE = "/mm-program-page";
const ID = 309;
const DIST = join(process.cwd(), "dist");

async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState("load");
}

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
      // 23 из 92 докладов приходят без трека: сегмент выпадает целиком, а не
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
