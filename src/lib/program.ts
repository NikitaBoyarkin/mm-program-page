/**
 * Домен программы — типы и чистые функции. Замороженный интерфейс.
 *
 * Здесь нет ни DOM, ни `fetch`: всё, что зависит от браузера, живёт в
 * `src/scripts/program-client.ts`, всё, что зависит от астро-рендера — в
 * `.astro`-компонентах. Поэтому логика сетки и календаря проверяется
 * обычным `bun test` без браузера и без сборки.
 *
 * Данные — `src/data/program.json`, нормализованный слепок API
 * (`bun run data:fetch` пересобирает его из `data/program.raw.json`).
 */
import raw from "../data/program.json";
import socialsOverlay from "../data/socials.json";
import { SOCIAL_NETWORKS, type SocialLink, type SocialNetwork } from "./socials";

export interface Lector {
  name: string;
  role: string;
  photo: string | null;
  /** Подтверждённые публичные ссылки; пусто у большинства спикеров. В слепке
   *  поля нет — его добавляет мердж `PROGRAM` из `src/data/socials.json`. */
  socials?: SocialLink[];
}

export interface Talk {
  id: number;
  dayId: number;
  hall: string;
  track: string;
  /** `null` — у трека нет записи в справочнике (27 докладов в слепке). */
  trackId: number | null;
  title: string;
  /** "HH:MM", локальное время конференции (МСК). */
  start: string;
  end: string;
  image: string | null;
  lectors: Lector[];
  /** Текст для карточки. Никогда не пустой: падает обратно на первый абзац. */
  short: string;
  /** Полный текст для модалки; может быть "". */
  description: string;
  highlighted: boolean;
  free: boolean;
  broadcastType: string;
}

export interface Hall {
  id: number;
  name: string;
  order: number;
}

export interface Track {
  id: number;
  name: string;
  description: string;
}

export interface Day {
  id: number;
  date: string;
  name: string;
  order: number;
  /** Залы, у которых в этот день есть доклады, в порядке `Hall.order`. */
  halls: string[];
}

export interface Program {
  source: string;
  generatedAt: string;
  event: { id: number; name: string; startDate: string; endDate: string };
  halls: Hall[];
  tracks: Track[];
  days: Day[];
  talks: Talk[];
}

type SocialOverlay = Record<string, Partial<Record<SocialNetwork, string>>>;

const SOCIALS = socialsOverlay as SocialOverlay;

/**
 * Ссылки лектора из overlay-файла `src/data/socials.json`. Файл отдельный, потому
 * что `bun run data:fetch` пересобирает `program.json` побайтово и стёр бы поле;
 * `--check` сравнивает слепок строкой. Только `https:` — поля извне, ссылка не
 * должна стать beacon'ом.
 */
export function socialsOf(
  name: string,
  overlay: Record<string, Partial<Record<SocialNetwork, string>>> = SOCIALS,
): SocialLink[] {
  const entry = overlay[name];
  if (!entry) return [];
  return SOCIAL_NETWORKS.flatMap((network) => {
    const raw = entry[network]?.trim() ?? "";
    if (!raw.startsWith("https://")) return [];
    try {
      // Та же нормализация, что делает клиент: карточка и модалка обязаны
      // получить один href (иначе `https://x.ru` ≠ `https://x.ru/`).
      return [{ network, url: new URL(raw).href }];
    } catch {
      return [];
    }
  });
}

const snapshot = raw as unknown as Program;

/** Разобранный слепок. Единственный источник данных на весь проект. */
export const PROGRAM: Program = {
  ...snapshot,
  talks: snapshot.talks.map((talk) => ({
    ...talk,
    lectors: talk.lectors.map((lector) => ({ ...lector, socials: socialsOf(lector.name) })),
  })),
};

export const TIME_RE = /^\d{2}:\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Префикс деплоя: `/` на корне домена, `/repo/` когда в `astro.config.mjs`
 * задан `base`. Vite подставляет `import.meta.env.BASE_URL` на билде, Bun
 * отдаёт `undefined` — отсюда фолбэк. Все ссылки и запросы строятся от него,
 * иначе `bun run build` с `base` даёт 404 на CSS, шрифтах и `/program.json`.
 */
export const BASE_URL: string = (() => {
  const raw = (import.meta.env as { BASE_URL?: string } | undefined)?.BASE_URL ?? "/";
  if (!raw.startsWith("/")) return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
})();

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/* ── Время ─────────────────────────────────────────────────────────── */

/** "11:00" → 660. Невалидное значение → null, а не NaN. */
export function minutes(value: string | null | undefined): number | null {
  const text = String(value ?? "");
  if (!TIME_RE.test(text)) return null;
  const [hours, mins] = text.split(":").map(Number);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** Валидное время суток: форма И диапазон (25:00 — не время). */
export const isTime = (value: unknown): boolean => minutes(String(value ?? "")) !== null;

/** "11:00" + "12:10" → "11:00 - 12:10" — ровно как на карточке оригинала. */
export function formatRange(talk: Pick<Talk, "start" | "end">): string {
  return `${talk.start} - ${talk.end}`;
}

/* ── Дни и залы ────────────────────────────────────────────────────── */

/** Дни в порядке программы (первый — 26 ноября, онлайн-день идёт последним). */
export function days(): Day[] {
  return [...PROGRAM.days].sort((a, b) => a.order - b.order);
}

export function talksOfDay(day: Day, talks: Talk[] = PROGRAM.talks): Talk[] {
  return talks.filter((talk) => talk.dayId === day.id);
}

/**
 * Колонки сетки этого дня: только залы, где есть доклады, в порядке
 * `Hall.order`. Порядок залов в дне (`Day.halls`) — объявленный, но
 * надёжнее вывести его из данных и подтвердить объявленным.
 */
export function hallsOfDay(day: Day, talks: Talk[] = PROGRAM.talks): string[] {
  const present = talksOfDay(day, talks)
    .map((talk) => talk.hall)
    .filter(Boolean);
  const order = new Map(PROGRAM.halls.map((hall) => [hall.name, hall.order]));
  const unique = Array.from(new Set(present));
  return unique.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** Все треки программы (11 штук) плюс всё, чего нет в справочнике. */
export function tracksOfProgram(talks: Talk[] = PROGRAM.talks): string[] {
  const known = PROGRAM.tracks.map((track) => track.name).filter(Boolean);
  for (const talk of talks) {
    if (talk.track && !known.includes(talk.track)) known.push(talk.track);
  }
  return known;
}

/** Доклад, который можно поставить в сетку: время валидно, зал известен. */
export function isPlaceable(talk: Talk, halls: string[]): boolean {
  const start = minutes(talk.start);
  const end = minutes(talk.end);
  return (
    Number.isFinite(talk.id) &&
    start != null &&
    end != null &&
    end >= start &&
    halls.includes(talk.hall)
  );
}

/** Уникальные времена начала, по возрастанию — это строки сетки. */
export function startsOf(talks: Talk[]): string[] {
  const seen = new Map<string, number>();
  for (const talk of talks) {
    const value = minutes(talk.start);
    if (value != null) seen.set(talk.start, value);
  }
  return [...seen.keys()].sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0));
}

/* ── Раскладка сетки ───────────────────────────────────────────────── */

export interface PlacedTalk {
  talk: Talk;
  /** 1-based строка CSS grid. */
  row: number;
  /** 1-based колонка CSS grid; время занимает колонку 1. */
  column: number;
  /** Сколько строк времени перекрывает доклад. */
  span: number;
}

/**
 * Сколько строк времени занимает доклад, начиная со строки `index`.
 * Доклад на 11:00–12:10 при строках 11:00, 11:40, 12:10 займёт 2 строки.
 */
export function spanOf(talk: Talk, rows: string[], index: number): number {
  const end = minutes(talk.end);
  let span = 1;
  for (let i = index + 1; i < rows.length; i += 1) {
    const next = minutes(rows[i]);
    if (end != null && next != null && next < end) span += 1;
    else break;
  }
  return span;
}

/**
 * Раскладка всех докладов дня в сетку «время × залы».
 *
 * Два правила, унаследованных от оригинала:
 *  1. Два доклада в одном зале на одно время — второй некуда поставить,
 *     он возвращается в `collisions` (а не теряется молча).
 *  2. Если доклад начинается внутри чужого слота, предыдущий укорачивается,
 *     чтобы ни одна карточка не исчезла.
 */
export function placeTalks(talks: Talk[], halls: string[], rows: string[]): {
  slots: PlacedTalk[];
  collisions: Talk[];
} {
  const placed = new Map<string, PlacedTalk>();
  const collisions: Talk[] = [];

  for (const talk of talks) {
    const column = halls.indexOf(talk.hall);
    const rowIndex = rows.indexOf(talk.start);
    if (column < 0 || rowIndex < 0) continue;
    const key = `${rowIndex}:${column}`;
    if (placed.has(key)) {
      collisions.push(talk);
      continue;
    }
    placed.set(key, {
      talk,
      row: rowIndex + 1,
      column: column + 2,
      span: spanOf(talk, rows, rowIndex),
    });
  }

  const byColumn = new Map<number, number[]>();
  for (const slot of placed.values()) {
    const list = byColumn.get(slot.column) ?? [];
    list.push(slot.row - 1);
    byColumn.set(slot.column, list);
  }
  for (const list of byColumn.values()) list.sort((a, b) => a - b);
  for (const slot of placed.values()) {
    const rowIndex = slot.row - 1;
    const next = byColumn.get(slot.column)?.find((value) => value > rowIndex);
    if (next != null) slot.span = Math.min(slot.span, next - rowIndex);
  }

  const slots = [...placed.values()].sort((a, b) => a.row - b.row || a.column - b.column);
  return { slots, collisions };
}

/** Ячейки, занятые докладом с `row`/`span`: нужны, чтобы не рисовать пустышки. */
export function occupiedCells(slots: PlacedTalk[]): Set<string> {
  const taken = new Set<string>();
  for (const slot of slots) {
    for (let offset = 0; offset < slot.span; offset += 1) {
      taken.add(`${slot.row + offset - 1}:${slot.column - 2}`);
    }
  }
  return taken;
}

/* ── Подписи ───────────────────────────────────────────────────────── */

/** 1 → "доклад", 2 → "доклада", 5 → "докладов". */
export function pluralTalks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "доклад";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "доклада";
  return "докладов";
}

/** "2026-11-26" → "(26 ноября)" — формат таба в оригинале. */
export function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!match) return "";
  const day = Number(match[3]);
  const month = MONTHS[Number(match[2]) - 1] ?? "";
  return `(${day} ${month})`;
}

/** "2026-11-26" → "26 ноября, ср". */
export function dayLongLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!match) return "";
  const stamp = new Date(`${date}T12:00:00Z`);
  const weekday = WEEKDAYS[stamp.getUTCDay()] ?? "";
  const day = Number(match[3]);
  const month = MONTHS[Number(match[2]) - 1] ?? "";
  return `${day} ${month}, ${weekday}`;
}

/** Первый абзац — запасной текст, если `short` пуст. */
export function firstParagraph(text: string | null | undefined): string {
  const value = String(text ?? "").trim();
  if (!value) return "";
  const [first] = value.split(/\n\s*\n/);
  return (first ?? "").trim();
}

/* ── Поиск ─────────────────────────────────────────────────────────── */

/** Резолв `?day=`: id, дата, порядковый номер или пусто → первый день. */
export function resolveDay(raw: string | null | undefined): Day {
  const list = days();
  if (!raw) return list[0]! as Day;
  return (
    list.find((day) => String(day.id) === String(raw)) ??
    list.find((day) => day.date === String(raw)) ??
    list[Number(raw) - 1] ??
    (list[0] as Day)
  );
}

export function dayByOrdinal(ordinal: number): Day {
  return days()[ordinal - 1] as Day;
}

/** Резолв `?track=`: id трека или его имя; неизвестный трек → null. */
export function resolveTrack(raw: string | null | undefined, day: Day): string | null {
  if (!raw) return null;
  const available = new Set(talksOfDay(day).map((talk) => talk.track));
  const known = PROGRAM.tracks.find(
    (track) =>
      String(track.id) === String(raw) || track.name.toLowerCase() === String(raw).toLowerCase(),
  );
  const name = known ? known.name : String(raw);
  return available.has(name) ? name : null;
}

export function talkById(id: number): Talk | undefined {
  return PROGRAM.talks.find((talk) => talk.id === Number(id));
}

/** URL дня: первый день живёт на `/`, остальные — `/day/N/`. */
export function dayHref(ordinal: number): string {
  return ordinal <= 1 ? BASE_URL : `${BASE_URL}day/${ordinal}/`;
}
