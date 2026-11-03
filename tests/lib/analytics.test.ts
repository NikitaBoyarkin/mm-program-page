/**
 * Чистая часть аналитики: разбор UTM и классификация первого источника.
 * Всё, что трогает `window`, здесь не проверяется — модуль грузится в Bun
 * без DOM.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyReferrer,
  computeFirstTouch,
  parseUtm,
} from "../../src/lib/analytics";

describe("parseUtm", () => {
  test("достаёт пять параметров", () => {
    const utm = parseUtm(
      "?utm_source=telegram&utm_medium=social&utm_campaign=mm_program_202611&utm_content=post_01&utm_term=prog",
    );
    expect(utm).toEqual({
      source: "telegram",
      medium: "social",
      campaign: "mm_program_202611",
      content: "post_01",
      term: "prog",
    });
  });

  test("пустая строка → пустой объект", () => {
    expect(parseUtm("")).toEqual({});
  });

  test("чужие параметры игнорируются", () => {
    expect(parseUtm("?track=product&foo=bar")).toEqual({});
  });

  test("регистр сохраняется: нормализацию делает сборщик ссылок", () => {
    expect(parseUtm("?utm_source=LinkedIn").source).toBe("LinkedIn");
  });

  test("значение обрезается до 100 символов", () => {
    const long = "a".repeat(500);
    expect(parseUtm(`?utm_campaign=${long}`).campaign).toHaveLength(100);
  });
});

describe("classifyReferrer", () => {
  test("пусто → direct", () => {
    expect(classifyReferrer("")).toBe("direct");
    expect(classifyReferrer(null)).toBe("direct");
  });

  test("известные хосты", () => {
    expect(classifyReferrer("www.linkedin.com")).toBe("linkedin");
    expect(classifyReferrer("github.com")).toBe("github");
    expect(classifyReferrer("www.google.com")).toBe("google");
  });

  test("неизвестный хост → other", () => {
    expect(classifyReferrer("t.me")).toBe("other");
  });
});

describe("computeFirstTouch", () => {
  test("класс, путь входа и UTM вместе", () => {
    const touch = computeFirstTouch(
      "https://www.linkedin.com/feed/",
      "/mm-program-page/",
      "?utm_source=linkedin&utm_medium=social",
    );
    expect(touch.referrer_class).toBe("linkedin");
    expect(touch.landing_path).toBe("/mm-program-page/");
    expect(touch.utm).toEqual({ source: "linkedin", medium: "social" });
  });

  test("битый referrer не бросает", () => {
    expect(computeFirstTouch("not a url", "/").referrer_class).toBe("direct");
  });
});
