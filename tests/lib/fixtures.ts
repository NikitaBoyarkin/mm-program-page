/**
 * Фабрики для тестов чистой логики: минимально валидные `Talk`/`Day`.
 *
 * Нужны, чтобы тест читался как сценарий сетки, а не как 15 обязательных
 * полей интерфейса. Данные программы здесь не дублируются — их проверяет
 * блок инвариантов в `program.test.ts`.
 */
import type { Day, Lector, Talk } from "../../src/lib/program";

export function makeLector(overrides: Partial<Lector> = {}): Lector {
  return {
    name: "Валерий Бабушкин",
    role: "Старший главный начальник, BP",
    photo: null,
    socials: [],
    ...overrides,
  };
}

export function makeTalk(overrides: Partial<Talk> = {}): Talk {
  return {
    id: 1,
    dayId: 10,
    hall: "Молекула",
    track: "ТРАНСФОРМАЦИЯ",
    trackId: 28,
    title: "Доклад",
    start: "11:00",
    end: "12:10",
    image: null,
    lectors: [],
    short: "Текст для карточки.",
    description: "",
    highlighted: false,
    free: false,
    broadcastType: "stream",
    ...overrides,
  };
}

export function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    id: 10,
    date: "2026-11-26",
    name: "1 день",
    order: 0,
    halls: ["Молекула", "Атом"],
    ...overrides,
  };
}
