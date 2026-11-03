#!/usr/bin/env bun
/**
 * Пересборка `src/data/program.json` из ответа публичного эндпоинта программы.
 *
 * Режимы (взаимоисключающие, по умолчанию `--check`):
 *
 *     bun run scripts/fetch-program.ts             # пересобрать и сравнить с закоммиченным
 *     bun run scripts/fetch-program.ts --check     # то же явно; exit 1 при расхождении
 *     bun run scripts/fetch-program.ts --dry-run   # посчитать в памяти, ничего не писать
 *     bun run scripts/fetch-program.ts --fetch     # скачать payload, затем пересобрать
 *
 * Порт `tools/fetch_program.py` один в один: те же поля, тот же порядок
 * нормализации и тот же `src/data/program.json` на выходе (`JSON.stringify`
 * с отступом 2 и завершающим переводом строки). Импорт модуля ничего не пишет:
 * все побочные эффекты живут в `main()`.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Day, Hall, Lector, Program, Talk, Track } from "../src/lib/program";

const ROOT = dirname(dirname(import.meta.path));
const RAW = join(ROOT, "data", "program.raw.json");
const OUT = join(ROOT, "src", "data", "program.json");
const SOURCE = "https://lms.matemarketing.ru/api/event-program/event/6/";
const USER_AGENT = "mm-program-page/2.0";
const TIMEOUT_MS = 30_000;

type Dict = Record<string, unknown>;

const dict = (value: unknown): Dict =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string =>
  typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

/* ── HTML → plain text ─────────────────────────────────────────────── */

/**
 * Named-сущности, которые реально встречаются в payload (плюс частые соседи).
 * Неизвестное имя остаётся как есть — ровно как `html.unescape` в Python.
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  shy: "\u00ad",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  minus: "\u2212",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  deg: "\u00b0",
  micro: "\u00b5",
  middot: "\u00b7",
  bull: "\u2022",
  laquo: "\u00ab",
  raquo: "\u00bb",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  bdquo: "\u201e",
  sbquo: "\u201a",
  rarr: "\u2192",
  larr: "\u2190",
  uarr: "\u2191",
  darr: "\u2193",
  harr: "\u2194",
  para: "\u00b6",
  sect: "\u00a7",
  dagger: "\u2020",
  permil: "\u2030",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  chi: "\u03c7",
  sigma: "\u03c3",
  mu: "\u03bc",
  pi: "\u03c0",
  omega: "\u03c9",
};

const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]*));/g;

/** Один проход раскодирования: `&amp;lt;` → `&lt;`, а не `<`. */
function decodeEntities(value: string): string {
  return value.replace(ENTITY_RE, (whole, dec: string, hex: string, name: string) => {
    if (dec) {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

/** Пробельные серии → один пробел (аналог `" ".join(value.split())`). */
const squeeze = (value: string): string => value.replace(/\s+/g, " ").trim();

/** HTML → плоский текст: блочные теги в перевод строки, сущности раскрыты. */
function plain(input: unknown): string {
  let value = text(input);
  value = value.replace(/<br\s*\/?>/gi, "\n");
  value = value.replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n\n");
  value = value.replace(/<li[^>]*>/gi, "\u2014 ");
  value = value.replace(/<[^>]+>/g, "");
  value = decodeEntities(value).replace(/\u00a0/g, " ");
  const blocks = value.split(/\n\s*\n|\n/).map(squeeze);
  return blocks.filter(Boolean).join("\n\n");
}

/** Текст в одну строку: для заголовков, ролей и `short_description`. */
const oneLine = (input: unknown): string => squeeze(plain(input));

/** Первый непустой абзац — запасной текст карточки. */
function firstParagraph(value: string): string {
  for (const block of value.split("\n\n")) {
    const cleaned = plain(block);
    if (cleaned) return cleaned;
  }
  return "";
}

/* ── Нормализация ──────────────────────────────────────────────────── */

/** "11:00:00" → "11:00"; пусто → "". */
const hhmm = (value: unknown): string => text(value).slice(0, 5);

/** `first_name middle_name last_name`, пустые части выброшены. */
function nameOf(lector: Dict): string {
  const parts = [lector.first_name, lector.middle_name, lector.last_name]
    .map(text)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(" ");
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Сырой payload API → объект контракта `Program`. */
export function normalize(raw: Dict): Program {
  const halls: Hall[] = list(raw.halls)
    .map((item) => {
      const hall = dict(item);
      return {
        id: hall.id as number,
        name: text(hall.name),
        order: Number(hall.order ?? 0) || 0,
      };
    })
    .sort((a, b) => a.order - b.order || a.id - b.id);
  const hallOrder = new Map(halls.map((hall) => [hall.name, hall.order]));

  const tracks: Track[] = list(raw.tracks).map((item) => {
    const track = dict(item);
    return {
      id: track.id as number,
      name: text(track.name),
      description: oneLine(track.description),
    };
  });

  const days: Day[] = [];
  const talks: Talk[] = [];

  for (const item of list(raw.days)) {
    const day = dict(item);
    const dayTalks = list(day.talks).map(dict);
    const present = new Set<string>();
    for (const talk of dayTalks) {
      const hall = dict(talk.hall);
      if (talk.hall) present.add(text(hall.name));
    }
    days.push({
      id: day.id as number,
      date: text(day.date),
      name: text(day.name),
      order: Number(day.order ?? 0) || 0,
      halls: [...present].sort(
        (a, b) => (hallOrder.get(a) ?? 999) - (hallOrder.get(b) ?? 999) || byText(a, b),
      ),
    });

    for (const talk of dayTalks) {
      const hall = dict(talk.hall);
      const track = dict(talk.track);
      const description = plain(talk.description);
      let short = oneLine(talk.short_description);
      if (!short) short = firstParagraph(description);

      const lectors: Lector[] = list(talk.lectors)
        .map(dict)
        .filter((lector) => nameOf(lector) !== "")
        .map((lector) => ({
          name: nameOf(lector),
          role: oneLine(lector.description),
          photo: (lector.photo ?? null) as string | null,
        }));

      talks.push({
        id: talk.id as number,
        dayId: day.id as number,
        hall: text(hall.name),
        track: text(track.name),
        trackId: (track.id ?? null) as number,
        title: oneLine(talk.name),
        start: hhmm(talk.start_time),
        end: hhmm(talk.end_time),
        image: (talk.image_url || talk.image || null) as string | null,
        lectors,
        short,
        description,
        highlighted: Boolean(talk.is_highlighted),
        free: Boolean(talk.free),
        broadcastType: text(talk.broadcast_type),
      });
    }
  }

  days.sort((a, b) => a.order - b.order || byText(a.date, b.date));
  talks.sort(
    (a, b) =>
      byText(a.start, b.start) || byText(a.hall, b.hall) || (a.id - b.id),
  );

  const dates = days.map((day) => day.date).sort(byText);

  return {
    source: SOURCE,
    generatedAt: stamp(new Date()),
    event: {
      id: (raw.event ?? null) as number,
      name: text(raw.event_name),
      startDate: dates[0] ?? (null as unknown as string),
      endDate: dates[dates.length - 1] ?? (null as unknown as string),
    },
    halls,
    tracks,
    days,
    talks,
  };
}

/** `Date` → "2026-11-02T20:22:10Z" — формат `generatedAt`. */
function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Payload → полный текст `src/data/program.json` (стабильный формат). */
export function render(payload: Program): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function summary(payload: Program): string {
  return (
    `${payload.days.length} дней, ${payload.talks.length} докладов, ` +
    `${payload.tracks.length} треков, ${payload.halls.length} залов`
  );
}

/* ── Сравнение ─────────────────────────────────────────────────────── */

/** Строка, которая меняется при каждом запуске и потому игнорируется в `--check`. */
const VOLATILE_RE = /^(\s*"generatedAt":\s*).*$/m;

const mask = (value: string): string => value.replace(VOLATILE_RE, '$1"__VOLATILE__"');

type Op = { kind: " " | "-" | "+"; text: string };

/** ops diff: общий префикс и суффикс отрезаются, середина — LCS. */
function diffOps(left: string[], right: string[]): Op[] {
  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1;
  let tail = 0;
  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) {
    tail += 1;
  }

  const a = left.slice(head, left.length - tail);
  const b = right.slice(head, right.length - tail);
  const ops: Op[] = left.slice(0, head).map((value) => ({ kind: " ", text: value }));

  if (a.length * b.length > 2_000_000) {
    for (const value of a) ops.push({ kind: "-", text: value });
    for (const value of b) ops.push({ kind: "+", text: value });
  } else {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          a[i] === b[j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        ops.push({ kind: " ", text: a[i] });
        i += 1;
        j += 1;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        ops.push({ kind: "-", text: a[i] });
        i += 1;
      } else {
        ops.push({ kind: "+", text: b[j] });
        j += 1;
      }
    }
    while (i < a.length) {
      ops.push({ kind: "-", text: a[i] });
      i += 1;
    }
    while (j < b.length) {
      ops.push({ kind: "+", text: b[j] });
      j += 1;
    }
  }

  for (const value of left.slice(left.length - tail)) ops.push({ kind: " ", text: value });
  return ops;
}

/** Unified diff с контекстом 1 — как `difflib.unified_diff(n=1)` в оригинале. */
function unifiedDiff(left: string[], right: string[], from: string, to: string): string[] {
  const ops = diffOps(left, right);
  const out = [`--- ${from}`, `+++ ${to}`];
  const context = 1;

  const changed = ops.map((op, index) => (op.kind === " " ? -1 : index)).filter((value) => value >= 0);
  if (!changed.length) return [];

  const hunks: Array<[number, number]> = [];
  let start = Math.max(0, changed[0]! - context);
  let end = Math.min(ops.length - 1, changed[0]! + context);
  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(ops.length - 1, index + context);
    } else {
      hunks.push([start, end]);
      start = Math.max(0, index - context);
      end = Math.min(ops.length - 1, index + context);
    }
  }
  hunks.push([start, end]);

  for (const [hunkStart, hunkEnd] of hunks) {
    let leftStart = 0;
    let rightStart = 0;
    for (let index = 0; index < hunkStart; index += 1) {
      if (ops[index]!.kind !== "+") leftStart += 1;
      if (ops[index]!.kind !== "-") rightStart += 1;
    }
    let leftCount = 0;
    let rightCount = 0;
    for (let index = hunkStart; index <= hunkEnd; index += 1) {
      if (ops[index]!.kind !== "+") leftCount += 1;
      if (ops[index]!.kind !== "-") rightCount += 1;
    }
    out.push(`@@ -${leftStart + 1},${leftCount} +${rightStart + 1},${rightCount} @@`);
    for (let index = hunkStart; index <= hunkEnd; index += 1) {
      out.push(`${ops[index]!.kind}${ops[index]!.text}`);
    }
  }
  return out;
}

/** Сравнить рендер с закоммиченным файлом, игнорируя только `generatedAt`. */
export function compare(expected: string, committed: string | null): string[] {
  if (committed === null) return ["<committed file is missing>"];
  if (mask(expected) === mask(committed)) return [];
  return unifiedDiff(
    mask(committed).split("\n"),
    mask(expected).split("\n"),
    `${relative(ROOT, OUT)} (committed)`,
    `${relative(ROOT, OUT)} (rebuilt)`,
  ).slice(0, 43);
}

/* ── I/O ───────────────────────────────────────────────────────────── */

const fail = (message: string): number => {
  console.error(`fetch_program: ${message}`);
  return 1;
};

const loadRaw = (path: string = RAW): Dict =>
  JSON.parse(readFileSync(path, "utf8")) as Dict;

/** Запись через соседний `.tmp`: сбой не оставит полуфайл. */
function writeAtomic(path: string, body: string | Uint8Array): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

/** Скачать тело ответа API. Сетевые ошибки — исключением наверх. */
async function download(timeout: number = TIMEOUT_MS): Promise<string> {
  const response = await fetch(SOURCE, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return await response.text();
}

/** Проверить, что тело — payload ожидаемой формы. */
function parseRaw(body: string): Dict {
  const data: unknown = JSON.parse(body);
  if (!data || typeof data !== "object" || !list(dict(data).days).length) {
    throw new Error("payload has no `days` — endpoint shape changed");
  }
  return data as Dict;
}

/* ── CLI ───────────────────────────────────────────────────────────── */

const USAGE = `usage: bun run scripts/fetch-program.ts [--fetch | --check | --dry-run]

  --fetch    скачать ${SOURCE} в data/program.raw.json, затем пересобрать
  --check    сравнить пересборку с закоммиченным src/data/program.json (по умолчанию)
  --dry-run  нормализовать в памяти и напечатать счётчики, ничего не записывая`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const modes = argv.filter((arg) => arg.startsWith("-"));
  for (const mode of modes) {
    if (!["--fetch", "--check", "--dry-run"].includes(mode)) {
      console.error(`fetch_program: неизвестный режим ${mode}\n\n${USAGE}`);
      return 2;
    }
  }
  if (new Set(modes).size > 1) {
    console.error(`fetch_program: режимы взаимоисключающие\n\n${USAGE}`);
    return 2;
  }
  const mode = modes[0] ?? "--check";

  let rawBody: string | null = null;
  let raw: Dict;
  if (mode === "--fetch") {
    try {
      rawBody = await download();
      raw = parseRaw(rawBody);
    } catch (error) {
      return fail(`не удалось скачать ${SOURCE}: ${(error as Error).message}`);
    }
  } else {
    try {
      raw = loadRaw();
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return fail(`нет входного файла ${relative(ROOT, RAW)} — запусти с --fetch`);
      }
      return fail(`${relative(ROOT, RAW)} — битый JSON: ${err.message}`);
    }
  }

  const payload = normalize(raw);
  const body = render(payload);

  if (mode === "--check") {
    let committed: string | null = null;
    try {
      committed = readFileSync(OUT, "utf8");
    } catch {
      committed = null;
    }
    const diff = compare(body, committed);
    if (!diff.length) {
      console.log(`OK: ${relative(ROOT, OUT)} совпадает с payload (${summary(payload)})`);
      return 0;
    }
    console.log(diff.join("\n"));
    return fail(`${relative(ROOT, OUT)} расходится с ${relative(ROOT, RAW)}`);
  }

  if (mode === "--dry-run") {
    console.log(`dry-run: ${summary(payload)}`);
    return 0;
  }

  if (rawBody !== null) writeAtomic(RAW, rawBody);
  writeAtomic(OUT, body);
  console.log(`${relative(ROOT, OUT)}: ${summary(payload)}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
