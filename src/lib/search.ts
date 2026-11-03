/**
 * Клиентский поиск по программе — чистая функция.
 *
 * Ни DOM, ни `fetch`: вход — уже загруженный `Program`, выход — упорядоченный
 * список докладов. Поэтому ранжирование проверяется обычным `bun test` без
 * браузера, а `program-client.ts` остаётся тонким: заполнить список и повесить
 * обработчики.
 *
 * Запрос пользователя никогда не превращается в RegExp: только `includes`.
 * Строка вида `a.*(` должна искать символы, а не бросать исключение.
 */
import type { Program, Talk } from "./program";

/** Ранг совпадения: меньше — выше в выдаче. */
const RANK_TITLE_START = 0;
const RANK_TITLE = 1;
const RANK_LECTOR = 2;
const RANK_TRACK_HALL = 3;
const RANK_SHORT = 4;

/**
 * Нормализация обеих сторон сравнения: регистр, `ё` → `е` (в русском поиске
 * пользователь набирает «е», а в тексте «ё»), схлопывание пробелов и обрезка.
 * Без неё «  Аналитика  » и «аналитика» — разные строки.
 */
function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Лучший (наименьший) ранг, с которым доклад отвечает запросу; `null` — не отвечает. */
function rankOf(talk: Talk, query: string): number | null {
  const title = normalize(talk.title);
  if (title.startsWith(query)) return RANK_TITLE_START;
  if (title.includes(query)) return RANK_TITLE;

  // Имя лектора сравнивается после нормализации: «Ёлкин» находится по «елкин».
  if (talk.lectors.some((lector) => normalize(lector.name).includes(query))) return RANK_LECTOR;

  if (normalize(talk.track).includes(query) || normalize(talk.hall).includes(query)) {
    return RANK_TRACK_HALL;
  }

  if (normalize(talk.short).includes(query)) return RANK_SHORT;

  return null;
}

/**
 * Доклады, отвечающие запросу, лучшие первыми.
 *
 * Порядок: начало заголовка → заголовок содержит → имя лектора → трек/зал →
 * текст карточки (`short`). Полное `description` намеренно не ищется: модалка
 * всё равно не открывается из выдачи, а длинные абзацы давали бы шум.
 *
 * Ничьи разрешаются детерминированно (`dayId`, затем `start`, затем `id`):
 * выдача не должна прыгать между запусками с одним и тем же запросом.
 */
export function searchTalks(program: Program, query: string, limit = 12): Talk[] {
  const needle = normalize(query);
  // Пустой запрос — не «все доклады»: выдача на пустоту выглядит как баг.
  if (!needle) return [];
  // Отрицательный `limit` в `slice` отсчитывается от конца и вернул бы
  // «всё, кроме последних N» — это не то, что просили.
  if (limit <= 0) return [];

  const best = new Map<number, { talk: Talk; rank: number }>();
  for (const talk of program.talks) {
    const rank = rankOf(talk, needle);
    if (rank == null) continue;
    // Дедупликация по `id`: один доклад попадает в выдачу один раз, с лучшим
    // рангом (если бы он совпал сразу по заголовку и по лектору).
    const seen = best.get(talk.id);
    if (seen && seen.rank <= rank) continue;
    best.set(talk.id, { talk, rank });
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.talk.dayId - b.talk.dayId ||
        a.talk.start.localeCompare(b.talk.start) ||
        a.talk.id - b.talk.id,
    )
    .slice(0, limit)
    .map((entry) => entry.talk);
}
