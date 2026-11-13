/**
 * Заметка доклада в собранной странице: `/talk/<id>/` и `/en/talk/<id>/`.
 *
 * Проверяется то, чего не видно в юнит-тестах: маршрут реально собран, факты
 * страницы совпадают со слепком, связь «Связанные» ведёт на существующие
 * адреса, переключатель языка остаётся на том же докладе, а модалка даёт вход.
 */
import { expect, test, type Page } from "playwright/test";

const BASE = "/mm-program-page";
const ID = 309;

async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState("load");
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
