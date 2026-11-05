/**
 * `.ics` — RFC 5545: экранирование, перенос строк по октетам и структура
 * календаря дня. `now` подставляется всегда: сравнение побайтовое, а не «на глаз».
 */
import { describe, expect, test } from "bun:test";
import {
  PROGRAM,
  days,
  talksOfDay,
} from "../../src/lib/program";
import {
  buildCalendar,
  calendarFilename,
  foldLine,
  icsDate,
  icsEscape,
  icsStamp,
} from "../../src/lib/ics";
import { makeDay, makeTalk } from "./fixtures";

const TZID = "Europe/Moscow";
const NOW = new Date("2026-11-02T18:22:10Z");
const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).length;

/** Снять folding, чтобы проверять содержимое свойств, а не разрывы. */
const unfold = (text: string): string => text.replace(/\r\n[ \t]/g, "");
const lines = (text: string): string[] => text.split("\r\n");
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("icsEscape", () => {
  test("экранирует обратный слеш, точку с запятой и запятую", () => {
    expect(icsEscape("a;b,c")).toBe("a\\;b\\,c");
    expect(icsEscape("путь\\nested")).toBe("путь\\\\nested");
    expect(icsEscape("смесь; ,\\")).toBe("смесь\\; \\,\\\\");
  });

  test("переводы строк → литерал \\n, включая CRLF и одиночный CR", () => {
    expect(icsEscape("первая\nвторая")).toBe("первая\\nвторая");
    expect(icsEscape("первая\r\nвторая")).toBe("первая\\nвторая");
    expect(icsEscape("первая\rвторая")).toBe("первая\\nвторая");
    expect(icsEscape("a\nb\nc")).toBe("a\\nb\\nc");
  });

  test("null/undefined → пустая строка, число → строка", () => {
    expect(icsEscape(null)).toBe("");
    expect(icsEscape(undefined)).toBe("");
    expect(icsEscape(309)).toBe("309");
  });
});

describe("foldLine", () => {
  test("короткая строка остаётся одной строкой", () => {
    expect(foldLine("SUMMARY:коротко")).toBe("SUMMARY:коротко");
    expect(foldLine("x".repeat(75))).toBe("x".repeat(75));
  });

  test("строка на 76 октетов переносится, продолжение начинается с пробела", () => {
    const folded = foldLine("x".repeat(76));
    expect(folded).toBe(`${"x".repeat(75)}\r\n x`);
  });

  test("кириллица не рвётся: каждая строка ≤ 75 октетов, unfolding возвращает исходник", () => {
    const value = `SUMMARY:${"Очень длинный заголовок доклада про аналитику и ИИ ".repeat(6).trim()}`;
    expect(bytes(value)).toBeGreaterThan(75);

    const folded = foldLine(value);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const line of physical) expect(bytes(line)).toBeLessThanOrEqual(75);
    for (const line of physical.slice(1)) expect(line.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toBe(value);
    // Ни одного битого символа: длина в байтах сохраняется.
    expect(bytes(unfold(folded))).toBe(bytes(value));
  });
});

describe("icsDate / icsStamp", () => {
  test("icsDate: дата и время → локальная метка без разделителей", () => {
    expect(icsDate("2026-11-26", "11:00")).toBe("20261126T110000");
    expect(icsDate("2026-11-17", "09:05")).toBe("20261117T090500");
  });

  test("icsStamp: UTC-метка с Z, стабильная для фиксированного Date", () => {
    expect(icsStamp(NOW)).toBe("20261102T182210Z");
    expect(icsStamp(new Date("2026-01-02T03:04:05Z"))).toBe("20260102T030405Z");
  });
});

describe("buildCalendar", () => {
  const day = makeDay({ id: 10, date: "2026-11-26", name: "1 день" });
  const talks = [
    makeTalk({ id: 1, start: "11:00", end: "12:10", hall: "Молекула", title: "Первый доклад" }),
    makeTalk({ id: 2, start: "11:00", end: "11:40", hall: "Атом", title: "Второй доклад" }),
  ];
  const text = buildCalendar(day, talks, NOW);
  const flat = unfold(text);

  test("обёртка VCALENDAR и по одному VEVENT на доклад", () => {
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(count(text, "BEGIN:VEVENT\r\n")).toBe(talks.length);
    expect(count(text, "END:VEVENT\r\n")).toBe(talks.length);
    expect(flat).toContain("VERSION:2.0");
    expect(flat).toContain("PRODID:-//mm-program-page//NONSGML program//EN");
    expect(flat).toContain("CALSCALE:GREGORIAN");
    expect(flat).toContain("METHOD:PUBLISH");
    expect(flat).toContain("X-WR-CALNAME:Матемаркетинг 2026 — 1 день");
  });

  test("только CRLF: одиночных \\n и \\r в файле нет", () => {
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\r");
    expect(text.endsWith("\r\n\r\n")).toBe(false);
  });

  test("VTIMEZONE объявлен до событий и с московским смещением", () => {
    expect(flat).toContain("BEGIN:VTIMEZONE");
    expect(flat).toContain(`TZID:${TZID}`);
    expect(flat).toContain("TZOFFSETFROM:+0300");
    expect(flat).toContain("TZOFFSETTO:+0300");
    expect(flat).toContain(`X-WR-TIMEZONE:${TZID}`);
    expect(flat.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(flat.indexOf("BEGIN:VEVENT"));
  });

  test("DTSTART/DTEND с TZID, SUMMARY, LOCATION, DESCRIPTION и UID", () => {
    expect(flat).toContain(`DTSTART;TZID=${TZID}:20261126T110000`);
    expect(flat).toContain(`DTEND;TZID=${TZID}:20261126T121000`);
    expect(flat).toContain("SUMMARY:Первый доклад");
    expect(flat).toContain("SUMMARY:Второй доклад");
    expect(flat).toContain("LOCATION:Молекула");
    expect(flat).toContain("LOCATION:Атом");
    expect(flat).toContain("DESCRIPTION:Текст для карточки.");
    expect(flat).toContain("UID:1@mm-program-page");
    expect(flat).toContain("UID:2@mm-program-page");
    expect(count(flat, "DTSTAMP:20261102T182210Z")).toBe(talks.length);
  });

  test("UID уникальны в пределах календаря", () => {
    const uids = flat
      .split("\r\n")
      .filter((line) => line.startsWith("UID:"))
      .map((line) => line.slice(4));
    expect(uids).toHaveLength(talks.length);
    expect(new Set(uids).size).toBe(uids.length);
  });

  test("тексты экранируются внутри свойств", () => {
    const tricky = buildCalendar(
      day,
      [makeTalk({ id: 7, title: "Итоги, планы; риски", short: "Тезис, ещё тезис; и точка." })],
      NOW,
    );
    const flatTricky = unfold(tricky);
    expect(flatTricky).toContain("SUMMARY:Итоги\\, планы\\; риски");
    expect(flatTricky).toContain("DESCRIPTION:Тезис\\, ещё тезис\\; и точка.");
  });

  test("DESCRIPTION падает обратно на первый абзац description", () => {
    const fallback = unfold(
      buildCalendar(
        day,
        [makeTalk({ id: 9, short: "", description: "Первый абзац.\n\nВторой абзац." })],
        NOW,
      ),
    );
    expect(fallback).toContain("DESCRIPTION:Первый абзац.");
    expect(fallback).not.toContain("Второй абзац.");
  });

  test("пустой short и пустое description → нет DESCRIPTION, но событие есть", () => {
    const bare = unfold(
      buildCalendar(day, [makeTalk({ id: 362, short: "", description: "" })], NOW),
    );
    expect(bare).not.toContain("DESCRIPTION:");
    expect(count(bare, "BEGIN:VEVENT")).toBe(1);
    expect(bare).toContain("UID:362@mm-program-page");
  });

  test("пустой день → календарь без VEVENT", () => {
    const empty = buildCalendar(day, [], NOW);
    expect(count(empty, "BEGIN:VEVENT")).toBe(0);
    expect(unfold(empty)).toContain("BEGIN:VTIMEZONE");
  });
});

describe("buildCalendar на реальных данных", () => {
  test("каждый день даёт столько VEVENT, сколько у него докладов, и все строки ≤ 75 октетов", () => {
    const now = new Date("2026-11-02T18:22:10Z");
    let total = 0;
    for (const day of days()) {
      const talks = talksOfDay(day);
      const text = buildCalendar(day, talks, now);
      expect(count(text, "BEGIN:VEVENT")).toBe(talks.length);
      expect(count(text, "END:VEVENT")).toBe(talks.length);
      total += talks.length;

      for (const line of lines(text)) expect(bytes(line)).toBeLessThanOrEqual(75);
      expect(unfold(text)).toContain(`DTSTART;TZID=${TZID}:${icsDate(day.date, talks[0]!.start)}`);
    }
    expect(total).toBe(PROGRAM.talks.length);
  });
});

describe("calendarFilename", () => {
  test("matemarketing-<дата>.ics", () => {
    expect(calendarFilename(makeDay({ date: "2026-11-26" }))).toBe("matemarketing-2026-11-26.ics");
    expect(calendarFilename(makeDay({ date: "2026-11-17" }))).toBe("matemarketing-2026-11-17.ics");
  });
});

describe("время доклада вне контракта", () => {
  const local = makeDay({ date: "2026-11-26", name: "1 день" });

  test("buildCalendar отвергает время, из которого можно собрать свойство", () => {
    expect(() => buildCalendar(local, [makeTalk({ start: "11:00\r\nX-EVIL:1" })], NOW)).toThrow(
      /время доклада/,
    );
    expect(() => buildCalendar(local, [makeTalk({ end: "25:00" })], NOW)).toThrow(/время доклада/);
    expect(() => buildCalendar(local, [makeTalk({ start: "1:00" })], NOW)).toThrow(/время доклада/);
  });

  test("X-WR-CALNAME берёт имя конференции из аргумента (EN-страница)", () => {
    const flat = unfold(buildCalendar(local, [], NOW, "Matemarketing 2026"));
    expect(flat).toContain("X-WR-CALNAME:Matemarketing 2026 — 1 день");
  });
});

describe("дата дня вне контракта", () => {
  const evil = "2026-11-26\r\nX-EVIL:1\r\nBEGIN:VALARM";

  test("buildCalendar отвергает всё, кроме YYYY-MM-DD", () => {
    expect(() => buildCalendar(makeDay({ date: evil }), [], NOW)).toThrow(/дата дня/);
    expect(() => buildCalendar(makeDay({ date: "26.11.2026" }), [], NOW)).toThrow(/дата дня/);
    expect(() => buildCalendar(makeDay({ date: "" }), [], NOW)).toThrow(/дата дня/);
  });

  test("calendarFilename отвергает то же самое — имя файла не ломается", () => {
    expect(() => calendarFilename(makeDay({ date: evil }))).toThrow(/дата дня/);
    expect(() => calendarFilename(makeDay({ date: "../../etc/passwd" }))).toThrow(/дата дня/);
  });
});
