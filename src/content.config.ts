import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * Заметки докладов: одна `.md` на доклад и язык. Файлы производятся
 * `scripts/generate-talk-notes.ts` из `src/data/program.json` и overlay'ев;
 * frontmatter — копия фактов слепка, и расхождение ловит `bun run talks:check`.
 * Тело правится руками и скриптом не перезаписывается.
 *
 * `.strict()` — чтобы опечатка в ключе падала на `astro sync`, а не терялась.
 */
const noteSchema = z
  .object({
    id: z.number().int().positive(),
    dayId: z.number().int().positive(),
    dayOrdinal: z.number().int().min(1).max(3),
    dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1),
    short: z.string(),
    track: z.string(),
    hall: z.string(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    lectors: z.array(z.object({ name: z.string().min(1), role: z.string() }).strict()),
    image: z.url().nullable(),
    highlighted: z.boolean(),
    free: z.boolean(),
    lang: z.enum(["ru", "en"]),
  })
  .strict();

const notes = (dir: string) =>
  defineCollection({
    loader: glob({ base: `./src/content/${dir}`, pattern: "[0-9]*.md" }),
    schema: noteSchema,
  });

export const collections = {
  talks: notes("talks"),
  "talks-en": notes("talks-en"),
};
