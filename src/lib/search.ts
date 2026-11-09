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
 *
 * Три режима, по убыванию строгости:
 * 1. Литеральный — запрос целиком как подстрока. Сюда попадают и запросы со
 *    знаками (`a.*(`, `C++`): токенизация съела бы пунктуацию и нашла больше,
 *    чем пользователь написал.
 * 2. Многословный — «маркетинг ретейл» ищет доклад, где каждое слово легло
 *    хоть в какое-то поле. Литеральный режим такого не находил вовсе: он
 *    требовал всю фразу подстрокой в одном поле.
 * 3. Опечатки — Levenshtein по словам, только на пустой литеральной выдаче,
 *    поэтому точное совпадение он не может ни подвинуть, ни вытеснить.
 */
import type { Program, Talk } from "./program-core";

/** Ранг совпадения: меньше — выше в выдаче. */
const RANK_TITLE_START = 0;
const RANK_TITLE = 1;
const RANK_LECTOR = 2;
const RANK_TRACK_HALL = 3;
const RANK_SHORT = 4;
/** Опечатка: ниже всех явных рангов и только когда явных нет вовсе. */
const RANK_APPROX = 5;

/**
 * Нормализация обеих сторон сравнения: регистр, `ё` → `е` (в русском поиске
 * пользователь набирает «е», а в тексте «ё»), схлопывание пробелов и обрезка.
 * Без неё «  Аналитика  » и «аналитика» — разные строки.
 *
 * `NFKD` намеренно не используется: он разлагает `й` на `и` + бриф, и «май»
 * начал бы совпадать с «маи».
 */
function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Слова запроса — или `null`, если запрос содержит что-то кроме букв, цифр и
 * пробелов: тогда режим литеральный и фолбэков нет. Иначе `a.*(` разложился
 * бы на `a`, и пунктуация как знак запроса потерялась бы.
 */
function wordsOfQuery(needle: string): string[] | null {
  if (/[^\p{L}\p{N}\s]/u.test(needle)) return null;
  const words = needle.split(/\s+/).filter(Boolean);
  return words.length ? words : null;
}

/** Расстояние Левенштейна, если оно `<= max`; `Infinity` за пределами бюджета. */
function distanceWithin(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1, // удаление
        (cur[j - 1] ?? 0) + 1, // вставка
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1), // замена
      );
      rowMin = Math.min(rowMin, cur[j] ?? 0);
    }
    // Расстояние не убывает по строкам: дешевле выйти, чем досчитать впустую.
    if (rowMin > max) return Infinity;
    prev = cur;
  }
  const tail = prev[b.length] ?? Infinity;
  return tail <= max ? tail : Infinity;
}

/**
 * Сколько правок может позволить слово такой длины: до 4 символов — ни одной
 * (короткое слово «совпадёт» с чем угодно), до 6 — одну, с 7 — две.
 */
function typoBudget(token: string): number {
  const length = [...token].length;
  if (length >= 7) return 2;
  if (length >= 4) return 1;
  return 0;
}

/**
 * Лучшее расстояние от слова запроса до любого слова доклада. Слово доклада
 * длиннее запроса сравнивается ещё и по своему началу в длину запроса — так
 * опечатка в основе («когорты») дотягивается до словоформы («когортный»).
 */
function bestWordIn(token: string, words: string[], max: number): number {
  let best = max + 1;
  for (const word of words) {
    const whole = distanceWithin(token, word, Math.min(max, best - 1));
    if (whole < best) best = whole;
    if (word.length > token.length) {
      const prefix = distanceWithin(token, word.slice(0, token.length), Math.min(max, best - 1));
      if (prefix < best) best = prefix;
    }
    if (best === 0) return 0;
  }
  return best <= max ? best : Infinity;
}

/** Все слова доклада, которые вообще участвуют в поиске. */
function searchableWords(talk: Talk): string[] {
  const text = [talk.title, ...talk.lectors.map((lector) => lector.name), talk.track, talk.hall, talk.short]
    .map(normalize)
    .join(" ");
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
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

/** Одна строка выдачи: доклад и слагаемые сортировки. */
type Hit = {
  talk: Talk;
  /** Худший ранг среди слов запроса: слабое звено определяет место в выдаче. */
  worst: number;
  /** Сумма рангов — второй критерий при равном `worst`. */
  sum: number;
  /** Сколько слов запроса доклад закрыл. */
  matched: number;
};

/** Дедупликация по `id`: один доклад — одна строка, с лучшим результатом. */
function dedupe(hits: Hit[]): Hit[] {
  const best = new Map<number, Hit>();
  for (const hit of hits) {
    const seen = best.get(hit.talk.id);
    if (
      seen &&
      (seen.matched > hit.matched ||
        (seen.matched === hit.matched &&
          (seen.worst < hit.worst || (seen.worst === hit.worst && seen.sum <= hit.sum))))
    ) {
      continue;
    }
    best.set(hit.talk.id, hit);
  }
  return [...best.values()];
}

/** Ничьи разрешаются детерминированно: выдача не прыгает между запусками. */
function byRank(a: Hit, b: Hit): number {
  return (
    a.worst - b.worst ||
    a.sum - b.sum ||
    a.talk.dayId - b.talk.dayId ||
    a.talk.start.localeCompare(b.talk.start) ||
    a.talk.id - b.talk.id
  );
}

/** Литеральный режим, а на пустой выдаче — опечатки по единственному слову. */
function literalHits(program: Program, needle: string, words: string[] | null): Hit[] {
  const hits: Hit[] = [];
  for (const talk of program.talks) {
    const rank = rankOf(talk, needle);
    if (rank != null) hits.push({ talk, worst: rank, sum: rank, matched: 1 });
  }
  if (hits.length) return dedupe(hits).sort(byRank);

  const token = words?.[0];
  const budget = token ? typoBudget(token) : 0;
  if (!token || !budget) return [];
  for (const talk of program.talks) {
    const distance = bestWordIn(token, searchableWords(talk), budget);
    if (distance === Infinity) continue;
    hits.push({ talk, worst: RANK_APPROX, sum: RANK_APPROX + distance, matched: 1 });
  }
  // Опечатка — уже фолбэк: её сортировка по расстоянию, а не по полю.
  return dedupe(hits).sort((a, b) => a.sum - b.sum || byRank(a, b));
}

/**
 * Многословный режим: слово найдено, если легло в любое поле доклада, ранг поля
 * задаёт место. Сначала доклады, ответившие на ВСЕ слова; только если таких
 * нет — на любое, иначе один промах обнулял бы выдачу целиком.
 */
function wordHits(program: Program, needle: string, words: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const talk of program.talks) {
    let worst = -1;
    let sum = 0;
    let matched = 0;
    for (const word of words) {
      const rank = rankOf(talk, word);
      if (rank == null) continue;
      matched += 1;
      sum += rank;
      if (rank > worst) worst = rank;
    }
    if (!matched) continue;
    // Фраза целиком, если она есть, — самый точный сигнал: «аналитика роста»
    // в начале заголовка не должна уступать докладу с разбросом по полям.
    const phrase = rankOf(talk, needle);
    if (phrase != null && phrase < worst) {
      worst = phrase;
      sum = phrase * matched;
    }
    hits.push({ talk, worst, sum, matched });
  }

  const full = hits.filter((hit) => hit.matched === words.length);
  const pool = dedupe(full.length ? full : hits);
  const compare = full.length
    ? byRank
    : (a: Hit, b: Hit) => b.matched - a.matched || byRank(a, b);
  return pool.sort(compare);
}

/**
 * Доклады, отвечающие запросу, лучшие первыми.
 *
 * Порядок: начало заголовка → заголовок содержит → имя лектора → трек/зал →
 * текст карточки (`short`) → опечатка. Полное `description` намеренно не
 * ищется: длинные абзацы давали бы шум.
 */
export function searchTalks(program: Program, query: string, limit = 12): Talk[] {
  const needle = normalize(query);
  // Пустой запрос — не «все доклады»: выдача на пустоту выглядит как баг.
  if (!needle) return [];
  // Отрицательный `limit` в `slice` отсчитывается от конца и вернул бы
  // «всё, кроме последних N» — это не то, что просили.
  if (limit <= 0) return [];

  const words = wordsOfQuery(needle);
  const hits = words && words.length > 1 ? wordHits(program, needle, words) : literalHits(program, needle, words);

  return hits.slice(0, limit).map((hit) => hit.talk);
}
