/**
 * E2E-проверка СОБРАННОЙ страницы: тесты идут против `dist/` через
 * `astro preview`, а не против dev-сервера, и ничего не мокают.
 *
 * Всё, кроме `testDir`/`webServer`, зафиксировано контрактом проверки:
 * без ретраев, `fullyParallel: false` (тесты одного файла идут
 * последовательно на одном сервере).
 *
 * Проектов три: десктопный chromium 1280×900 и два мобильных. Мобильные
 * запускают и общий набор (09–18), и тесты с собственным `test.use`:
 * мобильная модель включается CSS-медиазапросом `max-width: 767.98px`,
 * поэтому ширина окна — единственное, что её переключает.
 */
import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "tests/built",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4321",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Тема до первой отрисовки выбирается из `prefers-color-scheme`.
    // Дефолт Playwright — `light`, и тогда стартовое состояние страницы
    // было бы `light`, а не документированное `dark`. Пин на `dark`
    // делает цикл темы детерминированным.
    colorScheme: "dark",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1280, height: 900 },
      },
    },
    // Узкая мобильная модель: 320 px — нижняя граница, на которой строка
    // вкладок дней обязана вставать без горизонтального скролла.
    {
      name: "chromium-mobile",
      use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 320, height: 700 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    // Второй движок — WebKit на iPhone 13 (390×844): sticky-цепочка, `inert`,
    // `history.pushState` и `position: sticky` крестика модалки ведут себя
    // иначе, чем в Chromium, и регрессии ловятся только здесь.
    // Если браузер не установлен: `bunx playwright install webkit`.
    {
      name: "webkit-iphone",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        headless: true,
      },
    },
  ],
  webServer: {
    command: "bunx astro preview --port 4321 --host 127.0.0.1",
    // Проект собирается с `base: "/mm-program-page"` (`astro.config.mjs`),
    // поэтому корень домена отдаёт 404, а `astro preview` ждёт готовности
    // именно этой страницы — иначе 60 с таймаута до старта первого теста.
    url: "http://127.0.0.1:4321/mm-program-page/",
    reuseExistingServer: true,
    timeout: 60_000,
    // Astro 7 (`cli/preview/index.js`) при `isRunByAgent()` сам уводит
    // `astro preview` в фон и выходит с кодом 0 — для Playwright это
    // «Process from config.webServer exited early», и ни один тест не
    // запускается. `ASTRO_PREVIEW_BACKGROUND` отключает эту ветку
    // (`agentDetected = !process.env.ASTRO_PREVIEW_BACKGROUND && isRunByAgent()`),
    // оставляя сервер в форграунде. Сама команда не меняется.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
