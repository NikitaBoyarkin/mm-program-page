/**
 * Поиск по программе: нормализация, ранги и порядок.
 *
 * Проверяется чистая функция без DOM — ровно тот слой, который клиент вызывает
 * на каждый ввод. Порядок выдачи здесь и есть контракт: `[0]` — лучший результат.
 */
import { describe, expect, test } from "bun:test";
import type { Program, Talk } from "../../src/lib/program";
import { searchTalks } from "../../src/lib/search";
import { makeDay, makeLector, makeTalk } from "./fixtures";

/** Минимальная `Program`: поиску нужен только `talks`, остальное — для формы. */
function makeProgram(talks: Talk[]): Program {
  return {
    source: "test",
    generatedAt: "2026-11-01T00:00:00Z",
    event: { id: 1, name: "Тест", startDate: "2026-11-26", endDate: "2026-11-28" },
    halls: [],
    tracks: [],
    days: [makeDay({ id: 10 }), makeDay({ id: 11, order: 1 })],
    talks,
  };
}

const ids = (talks: Talk[]): number[] => talks.map((talk) => talk.id);

/** Доклад без совпадений по полям, кроме переданного: так тест читается точнее. */
const talk = (id: number, overrides: Partial<Talk> = {}): Talk =>
  makeTalk({ id, title: `Доклад ${id}`, track: "", hall: "", short: "", ...overrides });

describe("пустой запрос", () => {
  const program = makeProgram([talk(1, { title: "Аналитика роста", short: "Прогноз." })]);

  test("пустая строка → []", () => {
    expect(searchTalks(program, "")).toEqual([]);
  });

  test("пробелы, табы и переводы строк → []", () => {
    expect(searchTalks(program, "   ")).toEqual([]);
    expect(searchTalks(program, "\t\n  \n")).toEqual([]);
  });

  test("пустая программа → [] и на непустой запрос", () => {
    expect(searchTalks(makeProgram([]), "аналитика")).toEqual([]);
  });
});

describe("нормализация", () => {
  const program = makeProgram([
    talk(1, { title: "АНАЛИТИКА РОСТА" }),
    talk(2, { title: "Ёжики в аналитике" }),
    talk(3, { lectors: [makeLector({ name: "Пётр Ёлкин" })] }),
  ]);

  test("регистр не важен в обе стороны", () => {
    expect(ids(searchTalks(program, "аналитика"))).toContain(1);
    expect(ids(searchTalks(program, "АнАлИтИкА"))).toContain(1);
    expect(ids(searchTalks(program, "ЁЖИКИ"))).toEqual([2]);
  });

  test("ё в запросе и в тексте взаимозаменяемы", () => {
    expect(ids(searchTalks(program, "ежики"))).toEqual([2]);
    expect(ids(searchTalks(program, "ёжики"))).toEqual([2]);
    expect(ids(searchTalks(program, "петр елкин"))).toEqual([3]);
    expect(ids(searchTalks(program, "Пётр Ёлкин"))).toEqual([3]);
  });

  test("лишние пробелы в запросе не мешают", () => {
    const trimmed = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(ids(searchTalks(trimmed, "  аналитика   "))).toEqual([1]);
  });
});

describe("ранжирование", () => {
  test("совпадение в начале заголовка выше совпадения в тексте карточки", () => {
    const program = makeProgram([
      talk(1, { title: "Что-то про данные", short: "Аналитика и ещё раз аналитика." }),
      talk(2, { title: "Аналитика роста", short: "Прогноз." }),
    ]);
    expect(ids(searchTalks(program, "аналитика"))).toEqual([2, 1]);
  });

  test("заголовок содержит запрос выше, чем имя лектора", () => {
    const program = makeProgram([
      talk(1, { lectors: [makeLector({ name: "Мария Маркетингова" })] }),
      talk(2, { title: "Внутри — маркетинг" }),
    ]);
    expect(ids(searchTalks(program, "маркетинг"))).toEqual([2, 1]);
  });

  test("лектор выше трека и зала", () => {
    const program = makeProgram([
      talk(1, { track: "Маркетинговые системы" }),
      talk(2, { lectors: [makeLector({ name: "Ольга Маркетинг" })] }),
    ]);
    expect(ids(searchTalks(program, "маркетинг"))).toEqual([2, 1]);
  });

  test("трек и зал выше текста карточки", () => {
    const program = makeProgram([
      talk(1, { short: "Разговор про ретейл и полки." }),
      talk(2, { hall: "Ретейл" }),
      talk(3, { track: "Ретейл и продажи" }),
    ]);
    expect(ids(searchTalks(program, "ретейл"))).toEqual([2, 3, 1]);
  });
});

describe("поиск по полям", () => {
  test("по имени лектора", () => {
    const program = makeProgram([
      talk(1, { lectors: [makeLector({ name: "Валерий Бабушкин" })] }),
      talk(2, { lectors: [makeLector({ name: "Ирина Соколова" })] }),
    ]);
    expect(ids(searchTalks(program, "бабушкин"))).toEqual([1]);
  });

  test("по треку", () => {
    const program = makeProgram([
      talk(1, { track: "Трансформация" }),
      talk(2, { track: "Продукт" }),
    ]);
    expect(ids(searchTalks(program, "трансформация"))).toEqual([1]);
  });

  test("по залу", () => {
    const program = makeProgram([talk(1, { hall: "Молекула" }), talk(2, { hall: "Атом" })]);
    expect(ids(searchTalks(program, "молекула"))).toEqual([1]);
  });

  test("по тексту карточки", () => {
    const program = makeProgram([
      talk(1, { short: "Честный разбор провалов прошлого года." }),
      talk(2, { short: "Как строить прогнозы." }),
    ]);
    expect(ids(searchTalks(program, "провалов"))).toEqual([1]);
  });

  test("нет совпадений → []", () => {
    const program = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(searchTalks(program, "криптовалюта")).toEqual([]);
  });

  test("запрос с символами регулярки ищется буквально и не роняет поиск", () => {
    const program = makeProgram([talk(1, { title: "Аналитика (a.*b" })]);
    expect(() => searchTalks(program, "a.*(")).not.toThrow();
    // `.*` — два символа запроса, а не «что угодно»: регулярка не собирается.
    expect(ids(searchTalks(program, ".*"))).toEqual([1]);
    expect(searchTalks(program, "a.*(")).toEqual([]);
  });
});

describe("дедупликация и лимит", () => {
  test("один id — одна строка выдачи, даже если совпало и имя, и трек", () => {
    const program = makeProgram([
      talk(1, {
        title: "Бабушкин",
        lectors: [makeLector({ name: "Мария Бабушкина" })],
        track: "Бабушкин-трек",
      }),
    ]);
    expect(ids(searchTalks(program, "бабушкин"))).toEqual([1]);
  });

  test("дубли id в исходных данных не удваивают выдачу", () => {
    const program = makeProgram([talk(5, { title: "Рост" }), talk(5, { title: "Рост и рост" })]);
    expect(searchTalks(program, "рост")).toHaveLength(1);
  });

  test("limit по умолчанию — 12", () => {
    const program = makeProgram(
      Array.from({ length: 20 }, (_, index) => talk(index + 1, { title: `Рост ${index + 1}` })),
    );
    expect(searchTalks(program, "рост")).toHaveLength(12);
  });

  test("явный limit режет по порядку рангов", () => {
    const program = makeProgram([
      talk(1, { title: "Рост", short: "О росте." }),
      talk(2, { short: "Рост в тексте." }),
      talk(3, { track: "Рост" }),
    ]);
    expect(ids(searchTalks(program, "рост", 2))).toEqual([1, 3]);
  });

  test("неположительный limit → []", () => {
    const program = makeProgram([talk(1, { title: "Рост" })]);
    expect(searchTalks(program, "рост", 0)).toEqual([]);
    expect(searchTalks(program, "рост", -1)).toEqual([]);
  });
});

describe("многословный запрос", () => {
  test("доклад, ответивший на все слова, находится", () => {
    const program = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(ids(searchTalks(program, "аналитика роста"))).toEqual([1]);
  });

  test("все слова важнее части: частичное совпадение не разбавляет полное", () => {
    const program = makeProgram([
      talk(1, { title: "Аналитика роста" }),
      talk(2, { title: "Аналитика продаж" }),
    ]);
    expect(ids(searchTalks(program, "аналитика роста"))).toEqual([1]);
  });

  test("нет полного совпадения → доклады, закрывшие хоть одно слово", () => {
    const program = makeProgram([
      talk(1, { title: "Аналитика продаж" }),
      talk(2, { title: "Прогноз роста" }),
    ]);
    expect(ids(searchTalks(program, "аналитика роста")).sort()).toEqual([1, 2]);
  });

  test("место в выдаче определяет худшее поле доклада", () => {
    const program = makeProgram([
      talk(1, { track: "Ретейл", short: "Полки и выкладка." }),
      talk(2, { title: "Ретейл и полки" }),
    ]);
    expect(ids(searchTalks(program, "ретейл полки"))).toEqual([2, 1]);
  });

  test("слова могут лежать в разных полях: заголовок + имя лектора", () => {
    const program = makeProgram([
      talk(1, { title: "Юнит-экономика", lectors: [makeLector({ name: "Мария Бабушкина" })] }),
    ]);
    expect(ids(searchTalks(program, "экономика бабушкина"))).toEqual([1]);
  });

  test("порядок при равном ранге стабилен между вызовами", () => {
    const program = makeProgram([
      talk(1, { title: "Ретейл полки" }),
      talk(2, { title: "Ретейл и полки" }),
    ]);
    expect(ids(searchTalks(program, "ретейл полки"))).toEqual(
      ids(searchTalks(program, "ретейл полки")),
    );
  });
});

describe("опечатки", () => {
  test("одна лишняя буква в длинном слове не убивает выдачу", () => {
    const program = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(ids(searchTalks(program, "аналитикка"))).toEqual([1]);
  });

  test("фолбэк по опечаткам не включается, когда точное совпадение есть", () => {
    // «Аналогика» отличается от «аналитика» на две правки — но выдача не
    // пуста, значит фолбэк молчит и лишнего не добавляет.
    const program = makeProgram([
      talk(1, { title: "Аналитика роста" }),
      talk(2, { title: "Аналогика данных" }),
    ]);
    expect(ids(searchTalks(program, "аналитика"))).toEqual([1]);
  });

  test("короткое слово не нечёткое: «рот» не находит «рост»", () => {
    const program = makeProgram([talk(1, { title: "Рост" })]);
    expect(searchTalks(program, "рот")).toEqual([]);
  });

  test("запрос со знаком ищется буквально, без нечёткого фолбэка", () => {
    const program = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(searchTalks(program, "аналитик-ка")).toEqual([]);
  });

  test("совсем чужое слово по-прежнему даёт пусто", () => {
    const program = makeProgram([talk(1, { title: "Аналитика роста" })]);
    expect(searchTalks(program, "криптовалюта")).toEqual([]);
  });
});

describe("порядок при равном ранге", () => {
  test("сначала день, затем время начала, затем id", () => {
    const program = makeProgram([
      talk(30, { dayId: 11, start: "10:00", title: "Рост" }),
      talk(20, { dayId: 10, start: "15:00", title: "Рост" }),
      talk(10, { dayId: 10, start: "09:00", title: "Рост" }),
      talk(5, { dayId: 10, start: "09:00", title: "Рост" }),
    ]);
    expect(ids(searchTalks(program, "рост"))).toEqual([5, 10, 20, 30]);
  });

  test("повторный вызов на тех же данных даёт тот же порядок", () => {
    const program = makeProgram([
      talk(2, { dayId: 10, start: "11:00", title: "Рост" }),
      talk(1, { dayId: 10, start: "11:00", title: "Рост и убытки" }),
      talk(3, { dayId: 10, start: "10:00", title: "Рост" }),
    ]);
    expect(ids(searchTalks(program, "рост"))).toEqual(ids(searchTalks(program, "рост")));
  });
});
