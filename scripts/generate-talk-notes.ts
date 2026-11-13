#!/usr/bin/env bun
/**
 * Генерация заметок докладов: `src/content/talks/<id>.md` и `talks-en/<id>.md`.
 *
 * Режимы:
 *
 *     bun run scripts/generate-talk-notes.ts             # создать недостающие, обновить frontmatter
 *     bun run scripts/generate-talk-notes.ts --check     # exit 1 при дрейфе frontmatter / сироте
 *     bun run scripts/generate-talk-notes.ts --dry-run   # показать, что изменилось бы
 *
 * Тело заметки пишется один раз, при создании файла. Дальше его правит человек,
 * и скрипт его не трогает: перезаписывается только frontmatter-блок (сравнение
 * строкой — YAML-парсер не нужен). Импорт модуля ничего не пишет.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { localizeTalk } from "../src/lib/localize";
import { days, PROGRAM } from "../src/lib/program";
import { frontmatterOf, noteDataOf, noteSource, splitNote } from "../src/lib/talk-note";

const ROOT = dirname(dirname(import.meta.path));
const DIRS = { ru: join(ROOT, "src", "content", "talks"), en: join(ROOT, "src", "content", "talks-en") };
type Lang = keyof typeof DIRS;

interface Target {
  lang: Lang;
  path: string;
  frontmatter: string;
  source: string;
}

function targets(): Target[] {
  const dateOf = new Map(days().map((day, index) => [day.id, { ordinal: index + 1, date: day.date }]));
  const out: Target[] = [];
  for (const talk of PROGRAM.talks) {
    const meta = dateOf.get(talk.dayId);
    if (!meta) throw new Error(`доклад ${talk.id}: день ${talk.dayId} отсутствует в программе`);
    for (const lang of Object.keys(DIRS) as Lang[]) {
      const view = localizeTalk(lang, talk);
      const data = noteDataOf(view, { dayOrdinal: meta.ordinal, dayDate: meta.date, lang });
      out.push({
        lang,
        path: join(DIRS[lang], `${talk.id}.md`),
        frontmatter: frontmatterOf(data),
        source: noteSource(data, view.description),
      });
    }
  }
  return out;
}

function orphans(dir: string, ids: Set<string>): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => !ids.has(name.slice(0, -".md".length)))
    .map((name) => relative(ROOT, join(dir, name)));
}

function compare(target: Target): "missing" | "drift" | "ok" | "unparsed" {
  if (!existsSync(target.path)) return "missing";
  const split = splitNote(readFileSync(target.path, "utf8"));
  if (!split) return "unparsed";
  return split.frontmatter === target.frontmatter ? "ok" : "drift";
}

function write(target: Target): void {
  const state = compare(target);
  if (state === "missing") {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, target.source);
    return;
  }
  if (state === "unparsed") throw new Error(`${relative(ROOT, target.path)}: нет frontmatter-блока`);
  if (state === "ok") return;
  const body = splitNote(readFileSync(target.path, "utf8"))!.body;
  writeFileSync(target.path, `${target.frontmatter}${body}`);
}

function main(argv: string[]): number {
  const mode = argv.find((arg) => arg.startsWith("--"));
  if (mode && !["--check", "--dry-run"].includes(mode)) {
    console.error(`неизвестный режим: ${mode}`);
    return 2;
  }

  const list = targets();
  const ids = new Set(PROGRAM.talks.map((talk) => String(talk.id)));

  const problems = [
    ...list.filter((t) => compare(t) !== "ok").map((t) => `${relative(ROOT, t.path)}: ${compare(t)}`),
    ...orphans(DIRS.ru, ids),
    ...orphans(DIRS.en, ids),
  ];

  if (mode === "--check") {
    if (!problems.length) {
      console.log(`OK: ${list.length} заметок совпадают со слепком`);
      return 0;
    }
    console.log(problems.join("\n"));
    console.error(`расхождение: ${problems.length} (bun run talks:generate)`);
    return 1;
  }

  if (mode === "--dry-run") {
    console.log(problems.length ? problems.join("\n") : `OK: ${list.length} заметок без изменений`);
    return 0;
  }

  for (const target of list) write(target);
  console.log(`заметки: ${list.length} (${DIRS.ru.split("/").pop()} + ${DIRS.en.split("/").pop()})`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
