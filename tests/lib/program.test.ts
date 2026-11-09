/**
 * Данные программы и чистая логика сетки.
 *
 * Первый блок — контракт нормализованного слепка (`src/data/program.json`),
 * перенесённый из `tests/test_data.py`: если `--fetch` или нормализация
 * разъедутся с API, падает здесь, а не на глаз в браузере.
 * Второй блок — функции `src/lib/program.ts` на синтетических докладах.
 */
import { describe, expect, test } from "bun:test";
import {
  PROGRAM,
  TIME_RE,
  dayHref,
  dayLabel,
  dayLongLabel,
  days,
  firstBanner,
  firstParagraph,
  hallsOfDay,
  imageUrl,
  isPlaceable,
  minutes,
  occupiedCells,
  placeTalks,
  pluralTalks,
  resolveDay,
  socialsOf,
  spanOf,
  startsOf,
  talksOfDay,
  tracksOfProgram,
} from "../../src/lib/program";
import socialsOverlay from "../../src/data/socials.json";
import copyOverlay from "../../src/data/copy.ru.json";
import { SOCIAL_NETWORKS } from "../../src/lib/socials";
import { makeDay, makeTalk } from "./fixtures";

const SOURCE = "https://lms.matemarketing.ru/api/event-program/event/6/";
const TIME = /^\d{2}:\d{2}$/;
const HTTPS = /^https:\/\/\S+$/;
const ENTITY = /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);/;

// Порядок ключей в файле — часть формата (`--check` сравнивает побайтово).
const TOP_KEYS = ["source", "generatedAt", "event", "halls", "tracks", "days", "talks"];
const EVENT_KEYS = ["id", "name", "startDate", "endDate"];
const HALL_KEYS = ["id", "name", "order"];
const TRACK_KEYS = ["id", "name", "description"];
const DAY_KEYS = ["id", "date", "name", "order", "halls"];
const LECTOR_KEYS = ["name", "role", "photo"];
/** В памяти к слепку добавляется overlay соцсетей (файл не меняется). */
const LECTOR_MERGED_KEYS = [...LECTOR_KEYS, "socials"];
const TALK_KEYS = [
  "id",
  "dayId",
  "hall",
  "track",
  "trackId",
  "title",
  "start",
  "end",
  "image",
  "lectors",
  "short",
  "description",
  "highlighted",
  "free",
  "broadcastType",
];

const DAY_NAMES = ["1 день", "2 день", "Онлайн-день"];
const DAY_DATES = ["2026-11-26", "2026-11-27", "2026-11-17"];
const DAY_COUNTS = [39, 37, 15];
const STAGE_HALLS = ["Молекула", "Атом", "Архангельск", "Физика", "Кинетика"];
const ONLINE_HALLS = ["Онлайн-зал №1", "Онлайн-зал №2", "Онлайн-зал №3"];

/** Все строки payload, включая ключи: «undefined» в тексте — всегда баг. */
function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((item) => allStrings(item, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      allStrings(value, out);
    }
  }
  return out;
}

describe("program.json — контракт нормализованного слепка", () => {
  test("объёмы: 3 дня, 91 доклад, 11 треков, 9 залов", () => {
    expect(PROGRAM.days).toHaveLength(3);
    expect(PROGRAM.talks).toHaveLength(91);
    expect(PROGRAM.tracks).toHaveLength(11);
    expect(PROGRAM.halls).toHaveLength(9);
  });

  test("верхние ключи и их порядок заморожены", () => {
    expect(Object.keys(PROGRAM)).toEqual(TOP_KEYS);
    expect(Object.keys(PROGRAM.event)).toEqual(EVENT_KEYS);
    expect(PROGRAM.source).toBe(SOURCE);
    expect(PROGRAM.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("event описывает конференцию и её границы", () => {
    expect(PROGRAM.event.id).toBe(6);
    expect(PROGRAM.event.name).toBe("Матемаркетинг 2026");
    expect(PROGRAM.event.startDate).toBe("2026-11-17");
    expect(PROGRAM.event.endDate).toBe("2026-11-27");
  });

  test("дни: имена, даты и порядок 26 → 27 → онлайн", () => {
    expect(PROGRAM.days.map((day) => day.name)).toEqual(DAY_NAMES);
    expect(PROGRAM.days.map((day) => day.date)).toEqual(DAY_DATES);
    expect(PROGRAM.days.map((day) => day.order)).toEqual([0, 1, 2]);
    expect(days().map((day) => day.id)).toEqual(PROGRAM.days.map((day) => day.id));
    for (const day of PROGRAM.days) expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("залы каждого дня выводятся из докладов и идут по hall.order", () => {
    expect(PROGRAM.days[0]!.halls).toEqual(STAGE_HALLS);
    expect(PROGRAM.days[1]!.halls).toEqual(STAGE_HALLS);
    expect(PROGRAM.days[2]!.halls).toEqual(ONLINE_HALLS);

    const known = new Set(PROGRAM.halls.map((hall) => hall.name));
    const order = new Map(PROGRAM.halls.map((hall) => [hall.name, hall.order]));
    for (const day of PROGRAM.days) {
      expect(day.halls).toEqual(hallsOfDay(day));
      expect(new Set(day.halls).size).toBe(day.halls.length);
      for (const hall of day.halls) expect(known.has(hall)).toBe(true);
      const orders = day.halls.map((hall) => order.get(hall)!);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  test("доклады распределены по дням 39 / 37 / 15", () => {
    const counts = PROGRAM.days.map((day) => talksOfDay(day).length);
    expect(counts).toEqual(DAY_COUNTS);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(PROGRAM.talks.length);
  });

  test("каждый доклад попадает в свой день, зал и зал своего дня", () => {
    const dayById = new Map(PROGRAM.days.map((day) => [day.id, day]));
    const trackName = new Map(PROGRAM.tracks.map((track) => [track.id, track.name]));

    for (const talk of PROGRAM.talks) {
      const day = dayById.get(talk.dayId);
      expect(day).toBeDefined();
      expect(day!.halls).toContain(talk.hall);
      expect(talk.title.length).toBeGreaterThan(0);
      expect(talk.start).toMatch(TIME);
      expect(talk.end).toMatch(TIME);
      expect(talk.start < talk.end).toBe(true);

      if (talk.trackId === null) {
        // API отдаёт часть докладов без трека: тогда и имя пустое.
        expect(talk.track).toBe("");
      } else {
        expect(trackName.get(talk.trackId)).toBe(talk.track);
      }
    }
  });

  test("id докладов и залов уникальны", () => {
    const talkIds = PROGRAM.talks.map((talk) => talk.id);
    expect(new Set(talkIds).size).toBe(talkIds.length);
    const hallIds = PROGRAM.halls.map((hall) => hall.id);
    expect(new Set(hallIds).size).toBe(hallIds.length);
    const trackIds = PROGRAM.tracks.map((track) => track.id);
    expect(new Set(trackIds).size).toBe(trackIds.length);
  });

  test("медиа: https либо null", () => {
    for (const talk of PROGRAM.talks) {
      if (talk.image !== null) expect(talk.image).toMatch(HTTPS);
      for (const lector of talk.lectors) {
        expect(lector.name.trim().length).toBeGreaterThan(0);
        if (lector.photo !== null) expect(lector.photo).toMatch(HTTPS);
      }
    }
  });

  // Клиент рендерит только то, что прошло `imageUrl` (три CDN). Если `data:fetch`
  // принесёт четвёртый хост, карточка молча станет текстовой — ловим здесь.
  test("медиа: каждый непустой URL проходит белый список хостов", () => {
    const bad: string[] = [];
    for (const talk of PROGRAM.talks) {
      if (talk.image !== null && imageUrl(talk.image) === null) bad.push(talk.image);
      for (const lector of talk.lectors) {
        if (lector.photo !== null && imageUrl(lector.photo) === null) bad.push(lector.photo);
      }
    }
    expect(bad).toEqual([]);
  });

  test("тексты — плоский plain text без тегов и сущностей", () => {
    for (const talk of PROGRAM.talks) {
      for (const value of [talk.title, talk.short, talk.description]) {
        expect(value).not.toContain("<");
        expect(value).not.toContain(">");
        expect(ENTITY.test(value)).toBe(false);
      }
      for (const lector of talk.lectors) {
        expect(lector.role).not.toContain("<");
        expect(lector.role).not.toContain(">");
        expect(ENTITY.test(lector.role)).toBe(false);
      }
    }
    for (const track of PROGRAM.tracks) {
      expect(track.description).not.toContain("<");
      expect(ENTITY.test(track.description)).toBe(false);
    }
    for (const value of allStrings(PROGRAM)) {
      expect(["undefined", "null", "NaN"]).not.toContain(value);
    }
  });

  test("short всегда непуст, кроме доклада-заглушки без текста", () => {
    // id 362 — «ЗДЕСЬ БУДЕТ ЕЩЕ ОДНА ТЕМА»: в API пусты и short_description,
    // и description, поэтому fallback на первый абзац тоже даёт "". Это
    // единственная такая запись; появление второй — регрессия нормализации.
    const empty = PROGRAM.talks.filter((talk) => !talk.short.trim());
    expect(empty.map((talk) => talk.id)).toEqual([362]);
    for (const talk of empty) {
      expect(talk.description.trim()).toBe("");
      expect(talk.lectors).toEqual([]);
    }
    for (const talk of PROGRAM.talks) {
      if (talk.short.trim()) {
        expect(talk.short).toBe(talk.short.trim());
        expect(talk.short).not.toContain("\n");
      }
    }
  });

  test("overlay текста карточки: ключи — реальные id, текст чистый, short из overlay", () => {
    const byId = new Map(PROGRAM.talks.map((talk) => [String(talk.id), talk]));
    for (const [id, text] of Object.entries(copyOverlay)) {
      const talk = byId.get(id);
      expect(talk, `overlay: нет доклада ${id}`).toBeDefined();
      expect(text).toBe(text.trim());
      expect(text).not.toContain("\n");
      expect(text).not.toContain("<");
      expect(text).not.toContain(">");
      expect(talk!.short).toBe(text);
    }
  });

  test("схема полей зала, трека, дня, доклада и лектора", () => {
    for (const hall of PROGRAM.halls) expect(Object.keys(hall)).toEqual(HALL_KEYS);
    for (const track of PROGRAM.tracks) expect(Object.keys(track)).toEqual(TRACK_KEYS);
    for (const day of PROGRAM.days) expect(Object.keys(day)).toEqual(DAY_KEYS);
    for (const talk of PROGRAM.talks) {
      expect(Object.keys(talk)).toEqual(TALK_KEYS);
      for (const lector of talk.lectors) expect(Object.keys(lector)).toEqual(LECTOR_MERGED_KEYS);
    }
  });

  test("ветки рендера представлены в данных", () => {
    // Карточка без баннера, без спикеров, с пустым описанием и с 2+ лекторами —
    // каждая ветка обязана встречаться, иначе вёрстка проверена не полностью.
    expect(PROGRAM.talks.filter((talk) => talk.image === null).length).toBeGreaterThanOrEqual(10);
    expect(PROGRAM.talks.filter((talk) => talk.lectors.length > 1).length).toBeGreaterThanOrEqual(8);
    expect(PROGRAM.talks.filter((talk) => talk.lectors.length === 0).length).toBeGreaterThanOrEqual(8);
    expect(
      PROGRAM.talks.filter((talk) => talk.description.trim() === "").length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("соцсети лекторов — overlay src/data/socials.json", () => {
  const overlay = socialsOverlay as Record<string, Record<string, string>>;

  test("ключи — имена лекторов слепка, набор не пуст", () => {
    // Пустой overlay — регрессия сбора: иконки просто исчезнут со страницы.
    expect(Object.keys(overlay).length).toBeGreaterThan(0);
    const names = new Set(PROGRAM.talks.flatMap((talk) => talk.lectors.map((lector) => lector.name)));
    for (const name of Object.keys(overlay)) expect(names.has(name)).toBe(true);
  });

  test("только известные сети, только https, без пустых значений", () => {
    for (const [name, entry] of Object.entries(overlay)) {
      expect(name).toBe(name.trim());
      expect(Object.keys(entry).length).toBeGreaterThan(0);
      for (const [network, url] of Object.entries(entry)) {
        expect(SOCIAL_NETWORKS as readonly string[]).toContain(network);
        expect(url).toMatch(HTTPS);
        expect(url).toBe(url.trim());
      }
    }
  });

  test("socialsOf отбрасывает не-https и нормализует URL", () => {
    const links = socialsOf("Тестовый Лектор", {
      "Тестовый Лектор": {
        telegram: "javascript:alert(1)",
        linkedin: "  http://example.com  ",
        youtube: "https://youtu.be/x",
        site: "https://datahints.ru",
      },
    });
    expect(links).toEqual([
      { network: "youtube", url: "https://youtu.be/x" },
      { network: "site", url: "https://datahints.ru/" },
    ]);
  });

  test("PROGRAM добавляет socials в порядке SOCIAL_NETWORKS", () => {
    expect(socialsOf("Нет Такого Лектора")).toEqual([]);
    for (const talk of PROGRAM.talks) {
      for (const lector of talk.lectors) {
        const links = lector.socials ?? [];
        const order = links.map((link) => SOCIAL_NETWORKS.indexOf(link.network));
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        for (const link of links) expect(link.url).toMatch(HTTPS);
      }
    }
  });
});

describe("время", () => {
  test("minutes: валидное время → минуты от полуночи", () => {
    expect(minutes("00:00")).toBe(0);
    expect(minutes("11:00")).toBe(660);
    expect(minutes("12:10")).toBe(730);
    expect(minutes("23:59")).toBe(1439);
  });

  test("minutes: мусор → null, а не NaN", () => {
    for (const value of ["", "1:00", "11:0", "11:60", "24:00", "-1:00", "aa:bb", "11.00", null, undefined]) {
      expect(minutes(value as string | null | undefined)).toBeNull();
    }
    expect(TIME_RE.test("11:00")).toBe(true);
    expect(TIME_RE.test("11:0")).toBe(false);
  });

  test("startsOf: уникальные начала по возрастанию, невалидные выброшены", () => {
    const talks = [
      makeTalk({ id: 1, start: "12:10" }),
      makeTalk({ id: 2, start: "11:00" }),
      makeTalk({ id: 3, start: "11:40" }),
      makeTalk({ id: 4, start: "11:00" }),
      makeTalk({ id: 5, start: "oops" }),
    ];
    expect(startsOf(talks)).toEqual(["11:00", "11:40", "12:10"]);
    expect(startsOf([])).toEqual([]);
  });
});

describe("spanOf", () => {
  const rows = ["11:00", "11:40", "12:10", "12:40"];

  test("доклад в две строки: 11:00–12:10 при строках 11:00 / 11:40 / 12:10", () => {
    expect(spanOf(makeTalk({ start: "11:00", end: "12:10" }), rows, 0)).toBe(2);
  });

  test("доклад в три строки: 11:00–12:40 перекрывает 11:40 и 12:10", () => {
    expect(spanOf(makeTalk({ start: "11:00", end: "12:40" }), rows, 0)).toBe(3);
  });

  test("последняя строка и пустой хвост не растягивают слот", () => {
    expect(spanOf(makeTalk({ start: "12:40", end: "13:10" }), rows, 3)).toBe(1);
    expect(spanOf(makeTalk({ start: "11:00", end: "11:10" }), rows, 0)).toBe(1);
  });
});

describe("placeTalks", () => {
  const halls = ["Молекула", "Атом"];
  const rows = ["11:00", "11:40", "12:10"];

  test("две колонки: доклады в разных залах на одно время не конфликтуют", () => {
    const { slots, collisions } = placeTalks(
      [
        makeTalk({ id: 1, hall: "Молекула", start: "11:00", end: "12:10" }),
        makeTalk({ id: 2, hall: "Атом", start: "11:00", end: "11:40" }),
      ],
      halls,
      rows,
    );
    expect(collisions).toEqual([]);
    expect(slots.map((slot) => [slot.talk.id, slot.row, slot.column, slot.span])).toEqual([
      [1, 1, 2, 2],
      [2, 1, 3, 1],
    ]);
  });

  test("коллизия: второй доклад в том же зале и времени уходит в collisions", () => {
    const first = makeTalk({ id: 1, hall: "Молекула", start: "11:00", end: "11:40" });
    const second = makeTalk({ id: 2, hall: "Молекула", start: "11:00", end: "11:40" });
    const { slots, collisions } = placeTalks([first, second], halls, rows);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.talk.id).toBe(1);
    expect(collisions.map((talk) => talk.id)).toEqual([2]);
  });

  test("пересечение по времени укорачивает предыдущий слот, а не теряет доклад", () => {
    const { slots, collisions } = placeTalks(
      [
        makeTalk({ id: 1, hall: "Молекула", start: "11:00", end: "12:10" }),
        makeTalk({ id: 2, hall: "Молекула", start: "11:40", end: "12:05" }),
      ],
      halls,
      rows,
    );
    expect(collisions).toEqual([]);
    expect(slots.map((slot) => [slot.talk.id, slot.row, slot.span])).toEqual([
      [1, 1, 1],
      [2, 2, 1],
    ]);
  });

  test("неизвестный зал или время вне строк не создают слот", () => {
    const { slots, collisions } = placeTalks(
      [
        makeTalk({ id: 1, hall: "Трансформер" }),
        makeTalk({ id: 2, hall: "Молекула", start: "09:00" }),
      ],
      halls,
      rows,
    );
    expect(slots).toEqual([]);
    expect(collisions).toEqual([]);
  });

  test("occupiedCells: занятая ячейка на каждую строку слота, зал — индекс с нуля", () => {
    const { slots } = placeTalks(
      [
        makeTalk({ id: 1, hall: "Молекула", start: "11:00", end: "12:10" }),
        makeTalk({ id: 2, hall: "Атом", start: "12:10", end: "12:40" }),
      ],
      halls,
      rows,
    );
    expect([...occupiedCells(slots)].sort()).toEqual(["0:0", "1:0", "2:1"]);
  });
});

describe("подписи", () => {
  test("pluralTalks: 1 доклад, 2 доклада, 5 докладов", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(pluralTalks)).toEqual([
      "доклад",
      "доклада",
      "докладов",
      "докладов",
      "доклад",
      "доклада",
      "докладов",
    ]);
  });

  test("dayLabel: дата → «(26 ноября)», мусор → пусто", () => {
    expect(dayLabel("2026-11-26")).toBe("(26 ноября)");
    expect(dayLabel("2026-11-17")).toBe("(17 ноября)");
    expect(dayLabel("26.11.2026")).toBe("");
    expect(dayLabel("")).toBe("");
  });

  test("dayLongLabel: дата → «26 ноября, чт»", () => {
    expect(dayLongLabel("2026-11-26")).toBe("26 ноября, чт");
    expect(dayLongLabel("2026-11-27")).toBe("27 ноября, пт");
    expect(dayLongLabel("2026-11-17")).toBe("17 ноября, вт");
    expect(dayLongLabel("nope")).toBe("");
  });

  test("firstParagraph: первый непустой абзац, остальное отброшено", () => {
    expect(firstParagraph("Первый.\n\nВторой.")).toBe("Первый.");
    expect(firstParagraph("\n\n  Второй.  \n\nТретий.")).toBe("Второй.");
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph(null)).toBe("");
  });
});

describe("дни и ссылки", () => {
  test("resolveDay: id, дата, номер и мусор", () => {
    expect(resolveDay(null).id).toBe(10);
    expect(resolveDay("").id).toBe(10);
    expect(resolveDay("11").id).toBe(11);
    expect(resolveDay("2026-11-17").id).toBe(12);
    expect(resolveDay("2").id).toBe(11);
    expect(resolveDay("3").id).toBe(12);
    expect(resolveDay("42").id).toBe(10);
    expect(resolveDay("zzz").id).toBe(10);
  });

  test("dayHref: первый день на /, остальные на /day/N/", () => {
    expect(dayHref(1)).toBe("/");
    expect(dayHref(2)).toBe("/day/2/");
    expect(dayHref(3)).toBe("/day/3/");
  });

  test("hallsOfDay: только залы с докладами, порядок по hall.order", () => {
    const day = makeDay({ id: 999 });
    const talks = [
      makeTalk({ id: 1, dayId: 999, hall: "Физика" }),
      makeTalk({ id: 2, dayId: 999, hall: "Молекула" }),
      makeTalk({ id: 3, dayId: 999, hall: "Физика" }),
      makeTalk({ id: 4, dayId: 10, hall: "Кинетика" }),
    ];
    expect(hallsOfDay(day, talks)).toEqual(["Молекула", "Физика"]);
    expect(hallsOfDay(makeDay({ id: 1234 }), talks)).toEqual([]);
  });
});

describe("треки и размещаемость", () => {
  test("tracksOfProgram: 11 известных треков плюс всё, чего нет в справочнике", () => {
    const names = tracksOfProgram();
    expect(names).toHaveLength(11);
    expect(names).toEqual(PROGRAM.tracks.map((track) => track.name));
    expect(tracksOfProgram([makeTalk({ track: "НОВЫЙ ТРЕК" })])).toHaveLength(12);
    expect(tracksOfProgram([makeTalk({ track: "НОВЫЙ ТРЕК" })]).at(-1)).toBe("НОВЫЙ ТРЕК");
    expect(tracksOfProgram([makeTalk({ track: "" })])).toHaveLength(11);
  });

  test("isPlaceable: валидное время и известный зал", () => {
    const halls = ["Молекула", "Атом"];
    expect(isPlaceable(makeTalk({ start: "11:00", end: "12:10" }), halls)).toBe(true);
    expect(isPlaceable(makeTalk({ start: "11:00", end: "12:10", hall: "Трансформер" }), halls)).toBe(
      false,
    );
    expect(isPlaceable(makeTalk({ start: "12:10", end: "11:00" }), halls)).toBe(false);
    expect(isPlaceable(makeTalk({ start: "aa:bb", end: "12:10" }), halls)).toBe(false);
    expect(isPlaceable(makeTalk({ end: "мусор" }), halls)).toBe(false);
  });
});

describe("медиа: только известные CDN", () => {
  test("imageUrl пускает только три CDN первоисточника по https", () => {
    expect(imageUrl("https://img.matemarketing.ru/a/b.png")).toBe(
      "https://img.matemarketing.ru/a/b.png",
    );
    expect(imageUrl("https://storage.yandexcloud.net/x.webp")).toBe(
      "https://storage.yandexcloud.net/x.webp",
    );
    expect(imageUrl("https://mm-graphics.netlify.app/x.png")).toBe(
      "https://mm-graphics.netlify.app/x.png",
    );
    // Свой хост, чужой хост и не-https — не картинка.
    expect(imageUrl("https://attacker.example/pixel.png")).toBeNull();
    expect(imageUrl("http://img.matemarketing.ru/a.png")).toBeNull();
    expect(imageUrl("javascript:alert(1)")).toBeNull();
    expect(imageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(imageUrl("")).toBeNull();
    expect(imageUrl(null)).toBeNull();
  });

  test("firstBanner на реальном дне возвращает id из этого дня и https-баннер", () => {
    const day = days()[0]!;
    const banner = firstBanner(day);
    expect(banner).not.toBeNull();
    expect(talksOfDay(day).some((item) => item.id === banner!.id)).toBe(true);
    expect(banner!.url.startsWith("https://")).toBe(true);
  });
});
