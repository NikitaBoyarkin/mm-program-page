/**
 * Интернационализация: словарь оболочки, локальные подписи, адреса и overlay
 * переводов контента.
 *
 * Четыре механизма, которые держат переводы в связке:
 *  1. `src/i18n/ui.ts` — ключи обязаны совпадать в обоих языках, значения непустые.
 *  2. `src/i18n/format.ts` — русская ветка обязана совпадать с замороженным ядром
 *     `src/lib/program.ts`, иначе подписи разъедутся с `.ics` и `?day=`.
 *  3. `src/i18n/paths.ts` — первый день живёт на корне локали (`/`, `/en/`).
 *  4. `src/lib/localize.ts` + `src/data/program.en.json` — покрытие overlay'я
 *     91/91 и неизменность ссылочных полей (`track`, `hall`, `dayId`, время).
 */
import { describe, expect, test } from "bun:test";
import { LANGS, UI, otherLang, t } from "../../src/i18n/ui";
import { dayLabel, dayLongLabel, pluralDays, pluralTalks } from "../../src/i18n/format";
import { dayHrefFor, switchLangHref } from "../../src/i18n/paths";
import {
  dayNameLabel,
  hallLabel,
  localizeProgram,
  localizeTalk,
  trackLabel,
} from "../../src/lib/localize";
import {
  BASE_URL,
  PROGRAM,
  dayLabel as coreDayLabel,
  dayLongLabel as coreDayLongLabel,
  pluralTalks as corePluralTalks,
} from "../../src/lib/program";
import overlayRaw from "../../src/data/program.en.json";

/** Overlay в том же виде, в каком его читает `localize.ts`. */
const OVERLAY = overlayRaw as unknown as {
  tracks: Record<string, string>;
  halls: Record<string, string>;
  days: Record<string, string>;
  talks: Record<string, { title?: string; short?: string; description?: string; lectorRoles?: string[] }>;
};

const CYRILLIC = /[А-ЯЁа-яё]/;
/** «Заглушка» из слепка: у самого доклада `short` пуст, overlay честно повторяет. */
const PLACEHOLDER_TALK_ID = "362";

describe("ui: словарь оболочки", () => {
  test("LANGS описывает ровно два языка", () => {
    expect([...LANGS]).toEqual(["ru", "en"]);
  });

  test("ключи ru и en совпадают как множества", () => {
    expect(Object.keys(UI.en).sort()).toEqual(Object.keys(UI.ru).sort());
  });

  test("ни одно значение в обеих ветках не пустое", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(UI[lang])) {
        expect(typeof value, `${lang}.${key} — не строка`).toBe("string");
        expect(value.trim().length, `${lang}.${key} пустое`).toBeGreaterThan(0);
      }
    }
  });

  test("t подставляет {param} и оставляет неизвестный параметр видимым", () => {
    expect(t("ru", "cardFavAdd", { title: "Слои" })).toBe("В избранное: Слои");
    // Параметра нет — плейсхолдер обязан остаться в тексте, а не превратиться в "undefined".
    expect(t("ru", "cardFavAdd")).toBe("В избранное: {title}");
    expect(t("en", "footerTickets", { link: "Tickets" })).toBe(
      "Tickets for the conference — on the organizer's site.",
    );
    expect(t("ru", "introLine", { day: "26 ноября", n: 39, talks: "докладов", halls: 5 })).toContain(
      "26 ноября",
    );
    expect(t("ru", "introLine", { day: "26 ноября", n: 39, talks: "докладов", halls: 5 })).not.toContain(
      "{",
    );
  });

  test("english-маркеры не содержат кириллицы", () => {
    // `langSwitch` намеренно русский — это подпись переключателя для англоязычных.
    for (const key of ["pageTitle", "scheduleTitle", "emptyTrack", "factsTalks"] as const) {
      expect(CYRILLIC.test(t("en", key)), `en.${key} содержит кириллицу`).toBe(false);
    }
    expect(t("en", "pageTitle")).toBe("Conference program");
  });

  test("otherLang инволютивна", () => {
    for (const lang of LANGS) {
      expect(otherLang(otherLang(lang))).toBe(lang);
      expect(otherLang(lang)).not.toBe(lang);
    }
  });
});

describe("format: подписи совпадают с замороженным ядром", () => {
  // Защита от дрейфа: ядро знает только русский, локальная ветка обязана повторять.
  const CASES = [...Array.from({ length: 31 }, (_, i) => i), 101, 111, 121];

  test("pluralTalks(ru) === core pluralTalks для 0..30, 101, 111, 121", () => {
    for (const n of CASES) {
      expect(pluralTalks(n, "ru"), `n=${n}`).toBe(corePluralTalks(n));
    }
  });

  test("pluralTalks(en) даёт talk/talks", () => {
    expect(pluralTalks(1, "en")).toBe("talk");
    for (const n of [0, 2, 5, 11, 21, 101]) {
      expect(pluralTalks(n, "en"), `n=${n}`).toBe("talks");
    }
  });

  test("pluralDays: ru — день/дня/дней, en — day/days", () => {
    expect(pluralDays(1, "ru")).toBe("день");
    expect(pluralDays(21, "ru")).toBe("день");
    for (const n of [2, 3, 4, 22, 23, 24]) {
      expect(pluralDays(n, "ru"), `n=${n}`).toBe("дня");
    }
    for (const n of [0, 5, 11, 12, 13, 14, 25, 111]) {
      expect(pluralDays(n, "ru"), `n=${n}`).toBe("дней");
    }
    expect(pluralDays(1, "en")).toBe("day");
    for (const n of [0, 2, 3]) {
      expect(pluralDays(n, "en"), `n=${n}`).toBe("days");
    }
  });

  test("dayLabel(ru) === ядро; en — (Nov 26)", () => {
    expect(dayLabel("2026-11-26", "ru")).toBe(coreDayLabel("2026-11-26"));
    expect(dayLabel("2026-11-26", "ru")).toBe("(26 ноября)");
    expect(dayLabel("2026-11-26", "en")).toBe("(Nov 26)");
  });

  test("dayLongLabel(ru) === ядро; en начинается с 26 November", () => {
    expect(dayLongLabel("2026-11-26", "ru")).toBe(coreDayLongLabel("2026-11-26"));
    expect(dayLongLabel("2026-11-26", "ru")).toBe("26 ноября, чт");
    const english = dayLongLabel("2026-11-26", "en");
    expect(english.startsWith("26 November")).toBe(true);
    expect(english).toContain("Thu");
  });

  test("невалидная дата даёт пустую строку в обоих языках", () => {
    for (const bad of ["", "не-дата", "2026/11/26", "26.11.2026"]) {
      expect(dayLabel(bad, "ru"), `dayLabel ru: ${bad}`).toBe("");
      expect(dayLabel(bad, "en"), `dayLabel en: ${bad}`).toBe("");
      expect(dayLongLabel(bad, "ru"), `dayLongLabel ru: ${bad}`).toBe("");
      expect(dayLongLabel(bad, "en"), `dayLongLabel en: ${bad}`).toBe("");
    }
  });
});

describe("paths: адреса с учётом языка", () => {
  // Тест завязан на корневой деплой; иначе ожидания ниже не имеют смысла.
  test("BASE_URL в тестовой среде — корень", () => {
    expect(BASE_URL).toBe("/");
  });

  test("первый день — на корне локали, остальные — в day/N/", () => {
    expect(dayHrefFor("ru", 1)).toBe("/");
    expect(dayHrefFor("ru", 2)).toBe("/day/2/");
    expect(dayHrefFor("en", 1)).toBe("/en/");
    expect(dayHrefFor("en", 0)).toBe("/en/");
    expect(dayHrefFor("en", 3)).toBe("/en/day/3/");
  });

  test("switchLangHref ведёт на тот же день в другом языке", () => {
    expect(switchLangHref("ru", 2)).toBe("/en/day/2/");
    expect(switchLangHref("en", 1)).toBe("/");
  });
});

describe("localize: overlay переводов контента", () => {
  const coreIds = PROGRAM.talks.map((talk) => String(talk.id));
  const coreIdSet = new Set(coreIds);

  test("у каждого доклада есть запись в overlay (91/91)", () => {
    expect(PROGRAM.talks.length).toBe(91);
    expect(Object.keys(OVERLAY.talks).length).toBe(91);
    for (const id of coreIds) {
      expect(OVERLAY.talks[id], `нет перевода доклада ${id}`).toBeDefined();
    }
  });

  test("overlay не содержит лишних id", () => {
    const extra = Object.keys(OVERLAY.talks).filter((id) => !coreIdSet.has(id));
    expect(extra).toEqual([]);
  });

  test("title переведён у всех, short — везде, где он есть в ядре", () => {
    for (const talk of PROGRAM.talks) {
      const entry = OVERLAY.talks[String(talk.id)]!;
      expect(entry.title?.trim().length, `title доклада ${talk.id} пуст`).toBeGreaterThan(0);
      // Единственная заглушка слепка: в ядре `short` тоже пуст, overlay честно повторяет.
      if (String(talk.id) === PLACEHOLDER_TALK_ID) {
        expect(talk.short).toBe("");
        expect(entry.short).toBe("");
        continue;
      }
      expect(entry.short?.trim().length, `short доклада ${talk.id} пуст`).toBeGreaterThan(0);
    }
  });

  test("lectorRoles совпадает по длине со списком спикеров", () => {
    for (const talk of PROGRAM.talks) {
      const roles = OVERLAY.talks[String(talk.id)]!.lectorRoles ?? [];
      expect(roles.length, `роли доклада ${talk.id}`).toBe(talk.lectors.length);
      for (const role of roles) {
        expect(role.trim().length, `пустая роль доклада ${talk.id}`).toBeGreaterThan(0);
      }
    }
  });

  test("localizeTalk(ru) не создаёт копию", () => {
    const talk = PROGRAM.talks[0]!;
    expect(localizeTalk("ru", talk)).toBe(talk);
  });

  test("localizeTalk(en) меняет title, но не трогает ссылочные поля", () => {
    const talk = PROGRAM.talks.find((candidate) => {
      const entry = OVERLAY.talks[String(candidate.id)];
      return Boolean(entry?.title && entry.title !== candidate.title && candidate.lectors.length > 0);
    });
    expect(talk, "нет доклада с отличающимся переводом и спикерами").toBeDefined();

    const translated = localizeTalk("en", talk!);
    const entry = OVERLAY.talks[String(talk!.id)]!;

    expect(translated.title).toBe(entry.title!);
    expect(translated.title).not.toBe(talk!.title);
    // По этим полям клиент фильтрует сетку и ищет доклад в `/program.json`.
    expect(translated.track).toBe(talk!.track);
    expect(translated.hall).toBe(talk!.hall);
    expect(translated.dayId).toBe(talk!.dayId);
    expect(translated.start).toBe(talk!.start);
    expect(translated.end).toBe(talk!.end);
    expect(translated.id).toBe(talk!.id);
    expect(translated.short).toBe(entry.short ?? talk!.short);
    expect(translated.lectors[0]!.role).toBe(entry.lectorRoles![0]!);
    expect(translated.lectors[0]!.name).toBe(talk!.lectors[0]!.name);
  });

  test("localizeProgram(en) переводит справочники, но не состав", () => {
    const translated = localizeProgram("en");

    expect(translated.talks.length).toBe(91);
    expect(translated.days.length).toBe(3);
    expect(translated.halls.length).toBe(PROGRAM.halls.length);
    expect(translated.tracks.length).toBe(PROGRAM.tracks.length);

    for (const hall of translated.halls) {
      expect(hall.name).toBe(hallLabel("en", PROGRAM.halls.find((h) => h.id === hall.id)!.name));
      expect(CYRILLIC.test(hall.name), `зал ${hall.name} не переведён`).toBe(false);
    }
    for (const track of translated.tracks) {
      expect(track.name).toBe(trackLabel("en", PROGRAM.tracks.find((x) => x.id === track.id)!.name));
      expect(CYRILLIC.test(track.name), `трек ${track.name} не переведён`).toBe(false);
    }
    for (const day of translated.days) {
      const source = PROGRAM.days.find((d) => d.id === day.id)!;
      expect(day.name).toBe(dayNameLabel("en", source.name));
      expect(day.halls).toEqual(source.halls.map((hall) => hallLabel("en", hall)));
      // Ссылочные поля дня остаются исходными.
      expect(day.date).toBe(source.date);
      expect(day.order).toBe(source.order);
    }
    for (const talk of translated.talks) {
      const source = PROGRAM.talks.find((x) => x.id === talk.id)!;
      expect(talk.track).toBe(trackLabel("en", source.track));
      expect(talk.hall).toBe(hallLabel("en", source.hall));
      expect(talk.start).toBe(source.start);
      expect(talk.end).toBe(source.end);
    }
  });

  test("trackLabel/hallLabel/dayNameLabel: ru — тождество, en — overlay, неизвестное — фолбэк", () => {
    const [track] = PROGRAM.tracks;
    const [hall] = PROGRAM.halls;
    const [day] = PROGRAM.days;

    expect(trackLabel("ru", track!.name)).toBe(track!.name);
    expect(hallLabel("ru", hall!.name)).toBe(hall!.name);
    expect(dayNameLabel("ru", day!.name)).toBe(day!.name);

    expect(trackLabel("en", track!.name)).toBe(OVERLAY.tracks[track!.name]!);
    expect(trackLabel("en", track!.name)).not.toBe(track!.name);
    expect(hallLabel("en", hall!.name)).toBe(OVERLAY.halls[hall!.name]!);
    expect(dayNameLabel("en", day!.name)).toBe(OVERLAY.days[day!.name]!);

    expect(trackLabel("en", "НЕИЗВЕСТНЫЙ ТРЕК")).toBe("НЕИЗВЕСТНЫЙ ТРЕК");
    expect(hallLabel("en", "НЕИЗВЕСТНЫЙ ЗАЛ")).toBe("НЕИЗВЕСТНЫЙ ЗАЛ");
    expect(dayNameLabel("en", "НЕИЗВЕСТНЫЙ ДЕНЬ")).toBe("НЕИЗВЕСТНЫЙ ДЕНЬ");
    expect(trackLabel("en", "")).toBe("");
  });

  test("localizeProgram(ru) возвращает исходный объект", () => {
    expect(localizeProgram("ru")).toBe(PROGRAM);
  });
});
