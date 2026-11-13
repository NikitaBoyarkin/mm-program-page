/**
 * Контракт событий аналитики: имена в коде против карты `AnalyticsEvents`.
 *
 * `src/lib/analytics.ts` — единственное место, где имя события описано типом, но
 * TypeScript не видит, что событие вообще где-то отправлено: ключ без вызова и
 * вызов с опечаткой одинаково компилируются. Здесь обе стороны сверяются по
 * исходникам, без DOM: файл грузится в Bun, где `document` отсутствует.
 *
 * Тест намеренно читает `src/` как текст, а не импортирует компоненты: `.astro`
 * в Bun не разбирается, а именно там живут половина вызовов.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(dirname(import.meta.path)));
const SRC = join(ROOT, "src");
const ANALYTICS = join(SRC, "lib", "analytics.ts");

/** Все исходники под `src/`: `.ts` и `.astro` — других файлов с `track` нет. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".astro")) out.push(path);
  }
  return out;
}

const files = sourceFiles(SRC);

/** Ключи карты событий: строки верхнего уровня `  name: {` внутри интерфейса. */
function eventNames(): string[] {
  const source = readFileSync(ANALYTICS, "utf8");
  const block = /export interface AnalyticsEvents \{([\s\S]*?)\n\}/.exec(source);
  if (!block) throw new Error("analytics.ts: интерфейс AnalyticsEvents не найден");
  return [...block[1]!.matchAll(/^ {2}([a-z_]+): \{/gm)].map((match) => match[1]!);
}

/** Имена, которые код реально отправляет: литералы в `track("…"`. */
function emittedNames(): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/track\(\s*"([a-z0-9_]+)"/g)) {
      out.push({ name: match[1]!, file: path.slice(SRC.length + 1) });
    }
  }
  return out;
}

const declared = eventNames();
const emitted = emittedNames();
const emittedSet = new Set(emitted.map((item) => item.name));

describe("AnalyticsEvents ↔ src/", () => {
  test("карта событий разобрана", () => {
    // Пустой список означал бы, что сломался разбор, а не что карта пуста.
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared).size).toBe(declared.length);
  });

  test("у каждого объявленного события есть вызов", () => {
    expect(declared.filter((name) => !emittedSet.has(name))).toEqual([]);
  });

  test("каждый отправленный литерал объявлен в карте", () => {
    const unknown = emitted
      .filter((item) => !declared.includes(item.name))
      .map((item) => `${item.file}: ${item.name}`);
    expect(unknown).toEqual([]);
  });
});

describe("разметка, без которой события бесполезны", () => {
  test("заметка доклада несёт data-talk-id", () => {
    // Без него `outbound_click` по соцссылке спикера уходил бы с `talk_id: null`,
    // и «какой доклад привёл к переходу» не читалось бы вовсе.
    const note = readFileSync(join(SRC, "components", "TalkNote.astro"), "utf8");
    expect(note).toContain("data-talk-id");
  });

  test("base приложения не захардкожен в Analytics.astro", () => {
    // Второй литерал рядом с `base` в `astro.config.mjs` — вторая правда о
    // деплое: при смене base «выход наружу» молча начинает врать.
    const analytics = readFileSync(join(SRC, "components", "Analytics.astro"), "utf8");
    expect(analytics).not.toContain("/mm-program-page");
    expect(analytics).toContain("import.meta.env.BASE_URL");
  });
});
