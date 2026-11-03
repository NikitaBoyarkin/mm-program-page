/**
 * Переводы контента программы.
 *
 * Оболочка (кнопки, табы, подвал) живёт в словаре `src/i18n/ui.ts`; тексты
 * докладов, залов и треков — отдельным overlay'ем `src/data/program.en.json`.
 * Файл отдельный по той же причине, что и `socials.json`: `bun run data:fetch`
 * пересобирает `program.json` побайтово и стёр бы переводы.
 *
 * Пропуск в overlay'е — не ошибка: возвращаем исходную русскую строку, чтобы
 * страница рендерилась с неполным переводом, а не падала.
 */
import overlayRaw from "../data/program.en.json";
import type { Lang } from "../i18n/ui";
import { PROGRAM, type Program, type Talk } from "./program";

export interface TalkOverlay {
  title?: string;
  short?: string;
  description?: string;
  /** Роли спикеров по индексу: имя и фото не переводятся. */
  lectorRoles?: string[];
}

export interface Overlay {
  tracks: Record<string, string>;
  halls: Record<string, string>;
  days: Record<string, string>;
  talks: Record<string, TalkOverlay>;
}

const OVERLAY = overlayRaw as unknown as Overlay;

/** Текст из карты: нет ключа — исходное значение. */
function pick(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

export function trackLabel(lang: Lang, track: string): string {
  return lang === "ru" ? track : pick(OVERLAY.tracks, track);
}

export function hallLabel(lang: Lang, hall: string): string {
  return lang === "ru" ? hall : pick(OVERLAY.halls, hall);
}

export function dayNameLabel(lang: Lang, name: string): string {
  return lang === "ru" ? name : pick(OVERLAY.days, name);
}

/**
 * Только текстовые поля доклада. `track`, `hall`, `dayId`, `start`, `end`, `id`
 * остаются оригинальными: по ним клиент фильтрует сетку и ищет доклад в
 * `/program.json`, и переведённое значение сломало бы контракт `data-track`.
 */
export function localizeTalk(lang: Lang, talk: Talk): Talk {
  if (lang === "ru") return talk;
  const entry = OVERLAY.talks[String(talk.id)];
  if (!entry) return talk;
  return {
    ...talk,
    title: entry.title ?? talk.title,
    short: entry.short ?? talk.short,
    description: entry.description ?? talk.description,
    lectors: talk.lectors.map((lector, index) => ({
      ...lector,
      role: entry.lectorRoles?.[index] ?? lector.role,
    })),
  };
}

/**
 * Полный клон программы для `/en/program.json`. Здесь переводятся и ссылочные
 * поля (`track`, `hall`): модалка и `.ics` читают этот файл как готовый текст.
 * Описания треков в overlay'е отсутствуют — они остаются исходными.
 */
export function localizeProgram(lang: Lang, program: Program = PROGRAM): Program {
  if (lang === "ru") return program;
  return {
    ...program,
    halls: program.halls.map((hall) => ({ ...hall, name: hallLabel(lang, hall.name) })),
    tracks: program.tracks.map((track) => ({
      ...track,
      name: trackLabel(lang, track.name),
      description: track.description,
    })),
    days: program.days.map((day) => ({
      ...day,
      name: dayNameLabel(lang, day.name),
      halls: day.halls.map((hall) => hallLabel(lang, hall)),
    })),
    talks: program.talks.map((talk) => ({
      ...localizeTalk(lang, talk),
      track: trackLabel(lang, talk.track),
      hall: hallLabel(lang, talk.hall),
    })),
  };
}
