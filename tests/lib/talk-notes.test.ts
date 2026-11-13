/**
 * Заметки докладов: файлы на диске против слепка.
 *
 * Тест держит то, чего не видит `astro check`: `program.json` объявлен
 * единственным источником данных, а frontmatter каждой `.md` — его копия.
 * Копия стареет молча, поэтому сверка строка в строку с тем же форматером,
 * которым пишет генератор. Тело заметки не сравнивается никогда: его правит
 * человек.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { localizeTalk } from "../../src/lib/localize";
import { PROGRAM, days } from "../../src/lib/program";
import { frontmatterOf, noteDataOf, splitNote } from "../../src/lib/talk-note";
const ROOT = dirname(dirname(dirname(import.meta.path)));
const DIRS = { ru: join(ROOT, "src", "content", "talks"), en: join(ROOT, "src", "content", "talks-en") } as const;
const META = new Map(days().map((day, index) => [day.id, { ordinal: index + 1, date: day.date }] as const));

const files = (lang: keyof typeof DIRS): string[] =>
  readdirSync(DIRS[lang])
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length));

describe("заметки на диске", () => {
  test("по одной на доклад в каждой локали", () => {
    expect(files("ru").sort()).toEqual(PROGRAM.talks.map((talk) => String(talk.id)).sort());
    expect(files("en").sort()).toEqual(files("ru").sort());
  });

  test("имя файла — id доклада, лишних файлов нет", () => {
    const ids = new Set(PROGRAM.talks.map((talk) => String(talk.id)));
    for (const lang of ["ru", "en"] as const) {
      expect(files(lang).filter((name) => !ids.has(name))).toEqual([]);
      expect(files(lang).filter((name) => !/^\d+$/.test(name))).toEqual([]);
    }
  });

  test("frontmatter совпадает со слепком до байта", () => {
    const drift: string[] = [];
    for (const talk of PROGRAM.talks) {
      const meta = META.get(talk.dayId)!;
      for (const lang of ["ru", "en"] as const) {
        const path = join(DIRS[lang], `${talk.id}.md`);
        if (!existsSync(path)) {
          drift.push(`${lang}/${talk.id}: файла нет`);
          continue;
        }
        const split = splitNote(readFileSync(path, "utf8"));
        const view = localizeTalk(lang, talk);
        const expected = frontmatterOf(noteDataOf(view, { dayOrdinal: meta.ordinal, dayDate: meta.date, lang }));
        if (!split) drift.push(`${lang}/${talk.id}: нет frontmatter`);
        else if (split.frontmatter !== expected) drift.push(`${lang}/${talk.id}: frontmatter устарел`);
      }
    }
    expect(drift).toEqual([]);
  });

  test("язык в frontmatter совпадает с папкой", () => {
    for (const lang of ["ru", "en"] as const) {
      for (const id of files(lang)) {
        const raw = readFileSync(join(DIRS[lang], `${id}.md`), "utf8");
        expect(splitNote(raw)!.frontmatter).toContain(`lang: "${lang}"`);
      }
    }
  });
});

describe("тело заметки", () => {
  test("seed непустой там, где у доклада есть описание", () => {
    const empty: string[] = [];
    for (const talk of PROGRAM.talks) {
      const split = splitNote(readFileSync(join(DIRS.ru, `${talk.id}.md`), "utf8"))!;
      if (talk.description.trim() && !split.body.trim()) empty.push(String(talk.id));
    }
    expect(empty).toEqual([]);
  });
});
