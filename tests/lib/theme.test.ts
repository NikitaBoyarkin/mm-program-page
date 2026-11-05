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
import { createMorph } from "morphicons/dom";
import { THEMES, THEME_COLORS, THEME_ICONS, THEME_PATHS, nextTheme } from "../../src/lib/theme";

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

/* ── Иконки темы ───────────────────────────────────────────────────────
 * Морф падает не «на глаз», а исключением в `createMorph` при разборе `d`.
 * Фейковый элемент satisfies `PathEl` (нужен только `setAttribute`), поэтому
 * тест ловит опечатку в пути до браузера, а не после.
 */

const pathEl = () => {
  const written: string[] = [];
  return {
    written,
    setAttribute(name: string, value: string) {
      if (name === "d") written.push(value);
    },
  };
};

test("каждая иконка темы разбирается morphicons", () => {
  for (const theme of THEMES) {
    const el = pathEl();
    expect(() => createMorph(el, THEME_ICONS[theme]), `тема ${theme}`).not.toThrow();
    expect(el.written.length).toBe(1);
  }
});

test("THEME_ICONS и THEME_PATHS описывают один набор иконок на сетке 24", () => {
  expect(Object.keys(THEME_ICONS).sort()).toEqual([...THEMES].sort());
  expect(Object.keys(THEME_PATHS).sort()).toEqual([...THEMES].sort());
  for (const theme of THEMES) {
    const node = THEME_ICONS[theme];
    expect(node).toHaveLength(1);
    const [tag, attrs] = node[0] as [string, { d: string }];
    expect(tag).toBe("path");
    expect(attrs.d).toBe(THEME_PATHS[theme]);
    // 24×24: ни одна координата не выходит за холст.
    const numbers = attrs.d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    expect(numbers.every((value) => Math.abs(value) <= 24)).toBe(true);
  }
});

test("разметка берёт иконку из того же источника, а не из литерала", () => {
  const nav = readFileSync(path.join(ROOT, "src/components/Nav.astro"), "utf8");
  expect(nav).toContain("THEME_PATHS.dark");
  expect(nav).toContain("data-theme-icons");
  expect(nav).not.toContain("M21 12.79A9 9 0 1 1 11.21 3");
});
