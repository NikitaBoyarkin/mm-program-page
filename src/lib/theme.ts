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
export const THEMES = ["dark", "light", "cyberpunk"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_COLORS: Record<Theme, string> = {
  dark: "#1400c3",
  light: "#f4efca",
  cyberpunk: "#171717",
};

/** Следующая тема по кругу: dark → light → cyberpunk → dark. */
export function nextTheme(current: string | null | undefined): Theme {
  const safe = THEMES.includes(current as Theme) ? (current as Theme) : "dark";
  return THEMES[(THEMES.indexOf(safe) + 1) % THEMES.length] as Theme;
}
