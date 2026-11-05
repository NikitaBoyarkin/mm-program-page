/**
 * Три темы и цвета, которые нельзя выразить токеном.
 *
 * `meta[name="theme-color"]` принимает только литерал, а предрисуночный скрипт
 * в `<head>` обязан быть инлайновым (иначе страница мигает кремовым), поэтому
 * инлайновый скрипт не может импортировать этот модуль и держит свою копию
 * трёх hex в `Base.astro`. Копия связана тестом `tests/lib/theme.test.ts`:
 * значения обязаны совпадать с `--background-primary` каждой темы в
 * `src/styles/tokens.css`.
 */
import type { IconNode } from "morphicons";

export const THEMES = ["dark", "light", "cyberpunk"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_COLORS: Record<Theme, string> = {
  dark: "#1400c3",
  light: "#f4efca",
  cyberpunk: "#171717",
};

/**
 * Иконки трёх тем — сырые `d` на сетке 24×24 (луна, солнце, молния).
 * Один источник на разметку, морф и фолбэк без клиентского скрипта: `Nav.astro`
 * рендерит `d` из этого файла и отдаёт карту в `data-theme-icons`, откуда её
 * читает инлайновый фолбэк в `Base.astro`.
 */
export const THEME_PATHS: Record<Theme, string> = {
  dark: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  light:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41",
  cyberpunk: "M13 2 4.09 12.69a1 1 0 0 0 .77 1.64H10l-1 7.67L20.91 11.3a1 1 0 0 0-.77-1.63H14z",
};

/**
 * Те же иконки как `IconNode`. Драйвер `morphicons` кэширует разбор и план в
 * `WeakMap` по идентичности объекта, а строковый `IconInput` идёт мимо кеша:
 * каждый клик заново парсил бы оба `d` и пересобирал план. Ссылки стабильны
 * на всё время жизни модуля, поэтому план считается один раз на пару.
 */
export const THEME_ICONS: Record<Theme, IconNode> = {
  dark: [["path", { d: THEME_PATHS.dark }]],
  light: [["path", { d: THEME_PATHS.light }]],
  cyberpunk: [["path", { d: THEME_PATHS.cyberpunk }]],
};

/** Следующая тема по кругу: dark → light → cyberpunk → dark. */
export function nextTheme(current: string | null | undefined): Theme {
  const safe = THEMES.includes(current as Theme) ? (current as Theme) : "dark";
  return THEMES[(THEMES.indexOf(safe) + 1) % THEMES.length] as Theme;
}
