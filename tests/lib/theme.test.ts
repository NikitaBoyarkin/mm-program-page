/**
 * Три hex, которые нельзя выразить токеном, продублированы в трёх местах:
 * клиентский модуль (`src/lib/theme.ts`) и два инлайновых скрипта в
 * `Base.astro` (предрисуночный + фолбэк для 404 — инлайновый скрипт не умеет
 * импортировать). Этот тест — единственный механизм, который не даёт копиям
 * разъехаться: значения сверяются с `--background-primary` каждой темы.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { THEMES, THEME_COLORS, nextTheme } from "../../src/lib/theme";

const ROOT = path.resolve(import.meta.dir, "../..");
const tokens = readFileSync(path.join(ROOT, "src/styles/tokens.css"), "utf8");
const base = readFileSync(path.join(ROOT, "src/layouts/Base.astro"), "utf8");

/** Тело CSS-блока по селектору — с учётом вложенности фигурных скобок. */
function block(selector: string): string {
  const start = tokens.indexOf(selector);
  if (start === -1) throw new Error(`в tokens.css нет блока ${selector}`);
  const open = tokens.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (tokens[i] === "{") depth += 1;
    if (tokens[i] === "}") {
      depth -= 1;
      if (depth === 0) return tokens.slice(open + 1, i);
    }
  }
  throw new Error(`блок ${selector} не закрыт`);
}

function primaryColor(selector: string): string {
  const match = /--background-primary:\s*(#[0-9a-f]{3,8})/i.exec(block(selector));
  if (!match?.[1]) throw new Error(`в блоке ${selector} нет --background-primary`);
  return match[1].toLowerCase();
}

test("theme-color совпадает с --background-primary каждой темы", () => {
  expect(THEME_COLORS.dark.toLowerCase()).toBe(primaryColor(":root"));
  expect(THEME_COLORS.light.toLowerCase()).toBe(primaryColor('[data-theme="light"]'));
  expect(THEME_COLORS.cyberpunk.toLowerCase()).toBe(primaryColor('[data-theme="cyberpunk"]'));
});

test("Base.astro повторяет те же три значения в инлайновых скриптах", () => {
  for (const [theme, hex] of Object.entries(THEME_COLORS)) {
    expect(base.toLowerCase(), `Base.astro не знает цвет темы ${theme}`).toContain(hex.toLowerCase());
  }
});

test("nextTheme крутит три темы по кругу и переживает мусор", () => {
  expect(nextTheme("dark")).toBe("light");
  expect(nextTheme("light")).toBe("cyberpunk");
  expect(nextTheme("cyberpunk")).toBe("dark");
  expect(nextTheme(null)).toBe("light");
  expect(nextTheme("нет-такой")).toBe("light");
});

test("THEMES и THEME_COLORS описывают один и тот же набор", () => {
  expect(Object.keys(THEME_COLORS).sort()).toEqual([...THEMES].sort());
});
