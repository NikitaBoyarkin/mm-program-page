/**
 * Материалы спикеров: видео и статьи, которые человек опубликовал сам.
 *
 * Данных в API нет — только ручной поиск и проверка, поэтому материалы живут
 * отдельным overlay-файлом `src/data/materials.json` по той же причине, что и
 * `socials.json`: `bun run data:fetch` пересобирает слепок побайтово и стёр бы
 * поле. Модуль читает файл на билде и отдаёт готовую проекцию для страницы
 * доклада; `src/lib/program.ts` (заморожен) о материалах не знает.
 *
 * Две карты файла:
 * - `speakers` — имя лектора → его материалы (показываются на каждом его докладе);
 * - `talks` — id доклада → материалы по теме именно этого доклада.
 *
 * Всё, что не прошло валидацию, отбрасывается молча: битая ссылка в файле не
 * должна валить сборку всех 91 страницы, но и попасть в разметку не должна.
 */
import overlay from "../data/materials.json";

export const MATERIAL_KINDS = ["video", "article"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Пределы на билде: карточка спикера не превращается в свалку ссылок. */
export const MATERIAL_LIMITS = { perSpeaker: 2, perTalk: 1 } as const;

export interface Material {
  kind: MaterialKind;
  title: string;
  url: string;
}

export interface SpeakerMaterials {
  name: string;
  items: Material[];
}

export interface TalkMaterials {
  /** Материалы по теме самого доклада. */
  topic: Material[];
  /** Материалы авторов, сгруппированные по спикеру. */
  bySpeaker: SpeakerMaterials[];
}

type RawEntry = { kind?: unknown; title?: unknown; url?: unknown };
type RawOverlay = { speakers?: Record<string, RawEntry[]>; talks?: Record<string, RawEntry[]> };

const isKind = (value: unknown): value is MaterialKind =>
  typeof value === "string" && (MATERIAL_KINDS as readonly string[]).includes(value);

/** Абсолютный `https`-адрес. `http`, относительные и `javascript:` отсекаются. */
const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeKey = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Сырой список → валидные материалы: только `video|article`, только `https`,
 * только непустой заголовок, без повторов URL, не больше `limit` записей.
 * Порядок файла сохраняется — редактор расставляет ссылки сам.
 */
export function sanitizeMaterials(input: unknown, limit: number): Material[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Material[] = [];
  for (const raw of input) {
    if (out.length >= limit) break;
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as RawEntry;
    const title = normalizeKey(entry.title);
    if (!isKind(entry.kind) || title === "" || !isHttpsUrl(entry.url)) continue;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push({ kind: entry.kind, title, url: entry.url });
  }
  return out;
}

const data = overlay as RawOverlay;
const SPEAKERS: Record<string, RawEntry[]> = data.speakers ?? {};
const TALKS: Record<string, RawEntry[]> = data.talks ?? {};

/** Материалы одного спикера по полному имени (как в слепке). */
export function materialsOfSpeaker(name: string): Material[] {
  return sanitizeMaterials(SPEAKERS[name.trim()], MATERIAL_LIMITS.perSpeaker);
}

/** Материалы по теме доклада, id — строкой, как ключ JSON. */
export function materialsOfTalk(talkId: number): Material[] {
  return sanitizeMaterials(TALKS[String(talkId)], MATERIAL_LIMITS.perTalk);
}

/**
 * Проекция для страницы доклада. Спикер без материалов не попадает в список,
 * поэтому пустая секция не рендерится: страница проверяет обе длины.
 */
/** Минимум, который нужен от доклада: id и имена спикеров. */
export function materialsForTalk(talk: { id: number; lectors: Array<{ name: string }> }): TalkMaterials {
  const bySpeaker: SpeakerMaterials[] = [];
  const seenNames = new Set<string>();
  for (const lector of talk.lectors) {
    const name = lector.name.trim();
    if (name === "" || seenNames.has(name)) continue;
    seenNames.add(name);
    const items = materialsOfSpeaker(name);
    if (items.length > 0) bySpeaker.push({ name, items });
  }
  return { topic: materialsOfTalk(talk.id), bySpeaker };
}
