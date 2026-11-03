/**
 * Локальные подписи: даты и числительные. Домен (`src/lib/program.ts`)
 * заморожен и знает только русский, поэтому перевод дат живёт здесь.
 * Совпадение русской ветки с `pluralTalks` из ядра закреплено тестом.
 */
import type { Lang } from "./ui";

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const RU_WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(date: string): { day: number; month: number; weekday: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!match) return null;
  return {
    day: Number(match[3]),
    month: Number(match[2]) - 1,
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}

/** "2026-11-26" → "(26 ноября)" / "(Nov 26)" — подпись таба дня. */
export function dayLabel(date: string, lang: Lang): string {
  const value = parts(date);
  if (!value) return "";
  if (lang === "en") return `(${EN_MONTHS[value.month]?.slice(0, 3) ?? ""} ${value.day})`;
  return `(${value.day} ${RU_MONTHS[value.month] ?? ""})`;
}

/** "2026-11-26" → "26 ноября, ср" / "26 November, Wed". */
export function dayLongLabel(date: string, lang: Lang): string {
  const value = parts(date);
  if (!value) return "";
  if (lang === "en") {
    return `${value.day} ${EN_MONTHS[value.month] ?? ""}, ${EN_WEEKDAYS[value.weekday] ?? ""}`;
  }
  return `${value.day} ${RU_MONTHS[value.month] ?? ""}, ${RU_WEEKDAYS[value.weekday] ?? ""}`;
}

/** 1 → "доклад" / "talk", 2 → "доклада" / "talks". */
export function pluralTalks(count: number, lang: Lang): string {
  if (lang === "en") return count === 1 ? "talk" : "talks";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "доклад";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "доклада";
  return "докладов";
}

/** 1 → "день" / "day", 3 → "дня" / "days". */
export function pluralDays(count: number, lang: Lang): string {
  if (lang === "en") return count === 1 ? "day" : "days";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}
