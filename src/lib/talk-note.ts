/**
 * Заметка доклада: детерминированный frontmatter и разбор файла.
 *
 * Один источник для генератора (`scripts/generate-talk-notes.ts`) и тестов
 * (`tests/lib/talk-notes.test.ts`): если бы форматер жил в скрипте, тест
 * проверял бы копию, а не то, что пишется на диск.
 *
 * Модуль знает только типы ядра — JSON-слепок сюда не тянется, поэтому файл
 * безопасно импортировать откуда угодно.
 */
import type { Talk } from "./program-core";

export interface TalkNoteData {
  id: number;
  dayId: number;
  dayOrdinal: number;
  dayDate: string;
  title: string;
  short: string;
  track: string;
  hall: string;
  start: string;
  end: string;
  lectors: Array<{ name: string; role: string }>;
  image: string | null;
  highlighted: boolean;
  free: boolean;
  lang: "ru" | "en";
}

/**
 * Строка YAML-double-quoted. `JSON.stringify` даёт ровно тот подмножество
 * YAML-скаляров, где двоеточие, `#`, `«»` и NBSP не требуют ручных правил,
 * а экранирование `"` и `\` совпадает с YAML.
 */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/** Frontmatter вместе с оградами. Порядок полей фиксирован: иначе `--check` шумит. */
export function frontmatterOf(data: TalkNoteData): string {
  const lectors = data.lectors.length
    ? data.lectors.map((lector) => `  - name: ${quoted(lector.name)}\n    role: ${quoted(lector.role)}`).join("\n")
    : "  []";
  const lines = [
    "---",
    `id: ${data.id}`,
    `dayId: ${data.dayId}`,
    `dayOrdinal: ${data.dayOrdinal}`,
    `dayDate: ${quoted(data.dayDate)}`,
    `title: ${quoted(data.title)}`,
    `short: ${quoted(data.short)}`,
    `track: ${quoted(data.track)}`,
    `hall: ${quoted(data.hall)}`,
    `start: ${quoted(data.start)}`,
    `end: ${quoted(data.end)}`,
    "lectors:",
    lectors,
    `image: ${data.image === null ? "null" : quoted(data.image)}`,
    `highlighted: ${data.highlighted}`,
    `free: ${data.free}`,
    `lang: ${quoted(data.lang)}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

/** Тело заметки: абзацы описания, нормализованные переводы строк. */
export function bodyOf(description: string): string {
  const normalized = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}

export function noteSource(data: TalkNoteData, description: string): string {
  return `${frontmatterOf(data)}${bodyOf(description)}`;
}

export interface SplitNote {
  /** Первый frontmatter-блок вместе с оградами, включая завершающий перевод строки. */
  frontmatter: string;
  body: string;
}

/** Режет файл по первой паре `---`. Тело не разбирается и не нормализуется. */
export function splitNote(raw: string): SplitNote | null {
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) return null;
  return { frontmatter: text.slice(0, end + "\n---\n".length), body: text.slice(end + "\n---\n".length) };
}

/** Данные заметки из доклада. `talk` уже должен быть переведён вызывающим. */
export function noteDataOf(
  talk: Talk,
  meta: { dayOrdinal: number; dayDate: string; lang: "ru" | "en" },
): TalkNoteData {
  return {
    id: talk.id,
    dayId: talk.dayId,
    dayOrdinal: meta.dayOrdinal,
    dayDate: meta.dayDate,
    title: talk.title,
    short: talk.short,
    track: talk.track,
    hall: talk.hall,
    start: talk.start,
    end: talk.end,
    lectors: (talk.lectors ?? []).map((lector) => ({ name: lector.name, role: lector.role })),
    image: talk.image || null,
    highlighted: talk.highlighted,
    free: talk.free,
    lang: meta.lang,
  };
}
