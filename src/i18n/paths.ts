/**
 * Адреса с учётом языка. Первый день живёт на корне локали (`/`, `/en/`),
 * остальные — в `day/N/`. Всё строится от `BASE_URL`, иначе деплой в подпапку
 * GitHub Pages даёт 404.
 */
import { BASE_URL } from "../lib/program";
import type { Lang } from "./ui";

export function langPrefix(lang: Lang): string {
  return lang === "en" ? "en/" : "";
}

export function dayHrefFor(lang: Lang, ordinal: number): string {
  const prefix = langPrefix(lang);
  return ordinal <= 1 ? `${BASE_URL}${prefix}` : `${BASE_URL}${prefix}day/${ordinal}/`;
}

/** Тот же день в другом языке — переключатель в шапке не уводит с расписания. */
export function switchLangHref(lang: Lang, ordinal: number): string {
  return dayHrefFor(lang === "en" ? "ru" : "en", ordinal);
}
