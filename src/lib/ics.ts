/**
 * `.ics` для дня программы — RFC 5545, Europe/Moscow, без зависимостей.
 *
 * Функции чистые (кроме `downloadIcs`, который трогает DOM), поэтому календарь
 * проверяется в `bun test` сравнением с фикстурой, а не «на глаз в календаре».
 */
import { DATE_RE, firstParagraph, type Day, type Talk } from "./program";

const CRLF = "\r\n";
const TZID = "Europe/Moscow";

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "TZNAME:MSK",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Экранирование текстовых свойств: `\ ; ,` и переводы строк. */
export function icsEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Перенос строки по 75 октетов UTF-8 с ведущим пробелом — иначе кириллица
 * рвётся посередине символа и календарь показывает мусор.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let width = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75;
    if (width + size > limit) {
      parts.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** "2026-11-26" + "11:00" → "20261126T110000". */
export function icsDate(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/**
 * Дата дня пригодна и для `DTSTART`, и для имени файла: строго `YYYY-MM-DD`.
 *
 * `Day.date` приходит из внешнего payload, поэтому без проверки в календарь
 * можно вписать произвольные свойства (`"\r\nX-…"`), а имя файла — сломать.
 *
 * @throws если формат не совпадает с `DATE_RE`.
 */
function assertIcsDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new Error(`ics: некорректная дата дня — ${JSON.stringify(date)}`);
  }
}

/** UTC-метка `DTSTAMP`: 20261102T182210Z. */
export function icsStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Собирает календарь дня: один VEVENT на доклад.
 * `now` подставляется в тестах, чтобы вывод был побайтово стабильным.
 */
export function buildCalendar(day: Day, talks: Talk[], now: Date = new Date()): string {
  assertIcsDate(day.date);
  const stamp = icsStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mm-program-page//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Матемаркетинг 2026 — ${day.name || day.date}`)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
  ];

  for (const talk of talks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(talk.id)}@mm-program-page`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZID}:${icsDate(day.date, talk.start)}`,
      `DTEND;TZID=${TZID}:${icsDate(day.date, talk.end)}`,
      `SUMMARY:${icsEscape(talk.title)}`,
      `LOCATION:${icsEscape(talk.hall)}`,
    );
    const description = talk.short || firstParagraph(talk.description);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/** Имя файла: `matemarketing-2026-11-26.ics`. */
export function calendarFilename(day: Day): string {
  assertIcsDate(day.date);
  return `matemarketing-${day.date}.ics`;
}

/** Скачивание через Blob — единственная DOM-функция модуля. */
export function downloadIcs(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
