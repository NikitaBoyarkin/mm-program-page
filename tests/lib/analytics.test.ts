/**
 * Чистая часть аналитики: разбор UTM и классификация первого источника.
 * Всё, что трогает `window`, здесь не проверяется — модуль грузится в Bun
 * без DOM.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyLink,
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

describe("classifyLink", () => {
  const base = { hostname: "matemarketing.ru", pathname: "/tickets/" };

  test("соцсеть спикера берётся из класса, а не из хоста", () => {
    expect(
      classifyLink({
        ...base,
        className: "social-link social-link--telegram",
        hostname: "t.me",
        pathname: "/lofinibo",
      }),
    ).toEqual({ link: "social:telegram", kind: "social", network: "telegram" });
  });

  test("utm_content важнее хоста: портфолио живёт на том же домене", () => {
    expect(
      classifyLink({
        hostname: "nikitaboyarkin.github.io",
        pathname: "/projects/",
        utmContent: "nav-projects",
      }),
    ).toEqual({ link: "portfolio:nav-projects", kind: "portfolio", network: null });
  });

  test("CTA на сотрудничество не притворяется переходом в портфолио", () => {
    // Кнопка «обсудить проект» тоже несёт utm_content — иначе бронь из новой
    // сессии нечем связать с CTA. Различает их только utm_medium.
    expect(
      classifyLink({
        hostname: "cal.com",
        pathname: "/lofinibo/bored-call-me",
        utmContent: "footer",
        utmMedium: "cta",
      }),
    ).toEqual({ link: "cta:footer", kind: "cta", network: null });
  });

  test("билеты и первоисточник — свои слаги", () => {
    expect(classifyLink(base).link).toBe("ticket");
    expect(
      classifyLink({ hostname: "lms.matemarketing.ru", pathname: "/events/all/6/" }),
    ).toEqual({ link: "source", kind: "source", network: null });
  });

  test("прочее падает обратно на хост и путь", () => {
    expect(
      classifyLink({ hostname: "example.com", pathname: "/x/" }),
    ).toEqual({ link: "example.com/x/", kind: "other", network: null });
  });
});
