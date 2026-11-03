/**
 * E2E-проверка СОБРАННОЙ страницы: тесты идут против `dist/` через
 * `astro preview`, а не против dev-сервера, и ничего не мокают.
 *
 * Всё, кроме `testDir`/`webServer`, зафиксировано контрактом проверки:
 * один проект chromium (headless), без ретраев, `fullyParallel: false`
 * (тесты одного файла идут последовательно на одном сервере).
 */
import { defineConfig } from "playwright/test";

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
  ],
  webServer: {
    command: "bunx astro preview --port 4321 --host 127.0.0.1",
    url: "http://127.0.0.1:4321/",
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
