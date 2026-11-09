/**
 * Домен программы: данные и функции, которым нужен слепок.
 *
 * Чистые типы и хелперы живут в `src/lib/program-core.ts` и реэкспортируются
 * отсюда, поэтому `import { ... } from "../lib/program"` работает как раньше.
 * Но клиентские модули (`program-client.ts`, `ics.ts`, `i18n/paths.ts`) обязаны
 * импортировать `program-core`: этот файл на верхнем уровне читает
 * `src/data/program.json` и строит `PROGRAM`, а такой побочный эффект
 * tree-shaking не убирает — иначе 280 КБ слепка уезжают в браузер.
 *
 * Данные — `src/data/program.json`, нормализованный слепок API
 * (`bun run data:fetch` пересобирает его из `data/program.raw.json`).
 */
import raw from "../data/program.json";
import copyOverlay from "../data/copy.ru.json";
import socialsOverlay from "../data/socials.json";
import { SOCIAL_NETWORKS, type SocialLink, type SocialNetwork } from "./socials";
import {
  imageUrl,
  isPlaceable,
  placeTalks,
  startsOf,
  type Day,
  type Hall,
  type Program,
  type Talk,
  type Track,
} from "./program-core";

export * from "./program-core";

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

type CopyOverlay = Record<string, string>;

const COPY = copyOverlay as CopyOverlay;

/**
 * Текст карточки (`short`) из overlay `src/data/copy.ru.json`, ключ — id доклада.
 * Файл отдельный по той же причине, что `socials.json`: `bun run data:fetch`
 * пересобирает `program.json` побайтово, а `--check` сравнивает его строкой.
 * Пустое значение или отсутствие ключа — остаётся текст из слепка.
 */
export function cardTextOf(id: number, snapshot: string, overlay: CopyOverlay = COPY): string {
  const text = (overlay[String(id)] ?? "").trim();
  return text === "" ? snapshot : text;
}

const snapshot = raw as unknown as Program;

/** Разобранный слепок. Единственный источник данных на весь проект. */
export const PROGRAM: Program = {
  ...snapshot,
  talks: snapshot.talks.map((talk) => ({
    ...talk,
    short: cardTextOf(talk.id, talk.short),
    lectors: talk.lectors.map((lector) => ({ ...lector, socials: socialsOf(lector.name) })),
  })),
};

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
  const order = new Map(PROGRAM.halls.map((hall: Hall) => [hall.name, hall.order]));
  const unique = Array.from(new Set(present));
  return unique.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** Все треки программы (11 штук) плюс всё, чего нет в справочнике. */
export function tracksOfProgram(talks: Talk[] = PROGRAM.talks): string[] {
  const known = PROGRAM.tracks.map((track: Track) => track.name).filter(Boolean);
  for (const talk of talks) {
    if (talk.track && !known.includes(talk.track)) known.push(talk.track);
  }
  return known;
}

/**
 * Баннер первой карточки в порядке сетки — кандидат в LCP на десктопе.
 * Один расчёт на страницу: `ProgramPage` берёт `id` для `priority`, страница —
 * `url` для `<link rel=preload>`. На мобильной модели баннеры скрыты (`display:
 * none`), поэтому предзагрузка ограничена `media="(min-width: 768px)"`: иначе
 * телефон качал бы 400 КБ картинки, которой не видно.
 */
export function firstBanner(day: Day): { id: number; url: string } | null {
  const dayTalks = talksOfDay(day);
  const dayHalls = hallsOfDay(day, dayTalks);
  const placeable = dayTalks.filter((talk) => isPlaceable(talk, dayHalls));
  const rows = startsOf(placeable);
  for (const slot of placeTalks(placeable, dayHalls, rows).slots) {
    const url = imageUrl(slot.talk.image);
    if (url) return { id: slot.talk.id, url };
  }
  return null;
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
    (track: Track) =>
      String(track.id) === String(raw) || track.name.toLowerCase() === String(raw).toLowerCase(),
  );
  const name = known ? known.name : String(raw);
  return available.has(name) ? name : null;
}

export function talkById(id: number): Talk | undefined {
  return PROGRAM.talks.find((talk) => talk.id === Number(id));
}
