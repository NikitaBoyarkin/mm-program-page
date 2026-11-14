/**
 * Материалы спикеров: схема overlay-файла и проекция для страницы доклада.
 *
 * Файл `src/data/materials.json` пишется руками после внешнего поиска, поэтому
 * первый блок проверяет не «код работает», а данные: каждый ключ — реальное имя
 * из слепка и реальный id доклада, каждая ссылка — https с заголовком. Опечатка
 * в имени спикера иначе просто молча не нашла бы лектора.
 */
import { describe, expect, test } from "bun:test";
import overlay from "../../src/data/materials.json";
import { PROGRAM } from "../../src/lib/program";
import {
  MATERIAL_LIMITS,
  materialsForTalk,
  materialsOfSpeaker,
  materialsOfTalk,
  sanitizeMaterials,
} from "../../src/lib/materials";

const raw = overlay as { speakers: Record<string, unknown[]>; talks: Record<string, unknown[]> };

describe("materials.json — схема", () => {
  const lectorNames = new Set(PROGRAM.talks.flatMap((talk) => talk.lectors.map((lector) => lector.name)));
  const talkIds = new Set(PROGRAM.talks.map((talk) => String(talk.id)));

  test("ключи speakers — полные имена лекторов из слепка", () => {
    for (const name of Object.keys(raw.speakers)) {
      expect(lectorNames.has(name), `нет такого лектора: ${name}`).toBe(true);
    }
  });

  test("ключи talks — id докладов из слепка", () => {
    for (const id of Object.keys(raw.talks)) {
      expect(talkIds.has(id), `нет такого доклада: ${id}`).toBe(true);
    }
  });

  test("каждая запись валидна: kind, непустой title, абсолютный https", () => {
    for (const entries of [...Object.values(raw.speakers), ...Object.values(raw.talks)]) {
      for (const entry of entries) {
        const item = entry as { kind: string; title: string; url: string };
        expect(["video", "article"]).toContain(item.kind);
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(new URL(item.url).protocol).toBe("https:");
      }
    }
  });

  test("пределы соблюдены: ≤2 на спикера, ≤1 по теме доклада", () => {
    for (const entries of Object.values(raw.speakers)) {
      expect(entries.length).toBeLessThanOrEqual(MATERIAL_LIMITS.perSpeaker);
    }
    for (const entries of Object.values(raw.talks)) {
      expect(entries.length).toBeLessThanOrEqual(MATERIAL_LIMITS.perTalk);
    }
  });

  test("ни одна запись не теряется при валидации", () => {
    for (const [name, entries] of Object.entries(raw.speakers)) {
      expect(materialsOfSpeaker(name).length, name).toBe(entries.length);
    }
    for (const [id, entries] of Object.entries(raw.talks)) {
      expect(materialsOfTalk(Number(id)).length, id).toBe(entries.length);
    }
  });
});

describe("sanitizeMaterials", () => {
  test("отбрасывает не-https, пустой заголовок, чужой kind и повторы URL", () => {
    const items = sanitizeMaterials(
      [
        { kind: "video", title: "Хорошая", url: "https://example.com/a" },
        { kind: "video", title: "Дубль", url: "https://example.com/a" },
        { kind: "video", title: "HTTP", url: "http://example.com/b" },
        { kind: "video", title: "", url: "https://example.com/c" },
        { kind: "podcast", title: "Чужой вид", url: "https://example.com/d" },
        { kind: "article", title: "   ", url: "https://example.com/e" },
        { kind: "article", title: "Относительная", url: "/f" },
        null,
      ],
      10,
    );
    expect(items).toEqual([{ kind: "video", title: "Хорошая", url: "https://example.com/a" }]);
  });

  test("уважает лимит и порядок файла", () => {
    const items = sanitizeMaterials(
      [
        { kind: "article", title: "Первый", url: "https://example.com/1" },
        { kind: "video", title: "Второй", url: "https://example.com/2" },
        { kind: "video", title: "Третий", url: "https://example.com/3" },
      ],
      2,
    );
    expect(items.map((item) => item.title)).toEqual(["Первый", "Второй"]);
  });

  test("не-массив и пустое значение дают пустой список", () => {
    expect(sanitizeMaterials(undefined, 2)).toEqual([]);
    expect(sanitizeMaterials("nope", 2)).toEqual([]);
  });
});

describe("materialsForTalk", () => {
  const talk = {
    id: 309,
    lectors: [{ name: "Анна Коковина" }, { name: "Анна Коковина" }, { name: " " }],
  };

  test("повтор спикера не дублирует группу, пустое имя не попадает", () => {
    const { bySpeaker } = materialsForTalk(talk);
    expect(bySpeaker.length).toBeLessThanOrEqual(1);
    for (const group of bySpeaker) expect(group.name).toBe("Анна Коковина");
  });

  test("доклад без материалов даёт пустую проекцию — секция не рендерится", () => {
    const empty = materialsForTalk({ id: -1, lectors: [] });
    expect(empty).toEqual({ topic: [], bySpeaker: [] });
  });
});
