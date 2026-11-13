/**
 * Записка автора: UTM, разметка и точки монтирования.
 *
 * Проверяется исходник, а не собранная страница: контракт здесь — «какая
 * ссылка и какие атрибуты обязаны существовать», а не их порядок в DOM.
 * Отдельно держится пара, которую нельзя проверить на глаз: `utm_content`
 * и `data-cta-surface` обязаны приходить из одного `surface`, иначе клик из
 * подвала запишется в метрику как клик из конца дня.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LANGS, t } from "../../src/i18n/ui";

const ROOT = path.resolve(import.meta.dir, "../..");
const component = readFileSync(path.join(ROOT, "src/components/CollabCta.astro"), "utf8");
const base = readFileSync(path.join(ROOT, "src/layouts/Base.astro"), "utf8");
const dayRu = readFileSync(path.join(ROOT, "src/pages/day/[n].astro"), "utf8");
const dayEn = readFileSync(path.join(ROOT, "src/pages/en/day/[n].astro"), "utf8");

describe("UTM на брони", () => {
  // Три параметра описывают кампанию целиком и не зависят от поверхности.
  const fixed = [
    "utm_source=mm-program-page",
    "utm_medium=cta",
    "utm_campaign=collab_slot",
  ];

  test("кампания размечена полностью", () => {
    for (const param of fixed) expect(component).toContain(param);
  });

  test("utm_content — из того же surface, что и событие", () => {
    // Не литерал на поверхность: одна переменная кормит и ссылку, и разметку.
    // Проверяются оба места сразу — захардкоженный `utm_content=footer` ломает
    // первую строку, а разъехавшийся атрибут — вторую.
    expect(component).toContain("utm_content=${surface}");
    expect(component.match(/data-cta-surface=\{surface\}/g)).toHaveLength(2);
  });

  test("поверхность одна — подвал", () => {
    // Карточку в конце дня убрали: CTA живёт строкой в подвале, и вторая
    // поверхность в метрике означала бы блок, которого больше нет на странице.
    expect(component).toContain('const surface = "footer"');
    expect(component).not.toContain("day-end");
  });
});

describe("разметка ссылок", () => {
  test("обе кнопки открываются в новой вкладке без доступа к opener", () => {
    // `noreferrer` разрешён: это усиление, а не регрессия — тест не должен
    // наказывать за него.
    expect(component.match(/rel="noopener(?:\s+noreferrer)?"/g)).toHaveLength(2);
    expect(component.match(/target="_blank"/g)).toHaveLength(2);
  });

  test("атрибуты поверхности и цели стоят на ссылках", () => {
    expect(component.match(/data-cta-surface=\{surface\}/g)).toHaveLength(2);
    expect(component).toContain('data-cta-target="cal"');
    expect(component).toContain('data-cta-target="telegram"');
  });

  test("цели ссылок — календарь и телеграм", () => {
    expect(component).toContain("https://cal.com/lofinibo/bored-call-me");
    expect(component).toContain("https://t.me/lofinibo");
  });

  test("регион доступности: section с aria-labelledby", () => {
    expect(component).toContain("<section");
    expect(component).toContain("aria-labelledby={titleId}");
  });
});

describe("события", () => {
  test("оба события отправляются через track из lib/analytics", () => {
    expect(component).toContain('from "../lib/analytics"');
    expect(component).toContain('track("cta_view"');
    expect(component).toContain('track("cta_click"');
  });

  test("показ считается по вьюпорту, а не по загрузке", () => {
    expect(component).toContain("new IntersectionObserver");
    expect(component).toContain("threshold: 0.5");
    // `threshold` даёт колбэк и на нулевом пересечении, поэтому одного
    // `isIntersecting` мало: без проверки доли `cta_view` срабатывал бы от
    // первого пикселя. Это и есть регрессия, которую тест обязан ловить.
    expect(component).toContain("intersectionRatio < 0.5");
    expect(component).not.toMatch(/if \(!entry\.isIntersecting\) continue;/);
    // Один показ на поверхность за загрузку.
    expect(component).toContain("seen.has(surface)");
    expect(component).toContain("observer.unobserve(entry.target)");
  });

  test("язык считается от base, а не от подстроки в пути", () => {
    expect(component).toContain("window.location.pathname");
    // `/mm-program-page/en` без слэша на конце — та же EN-страница:
    // `path.includes("/en/")` вернул бы для неё "ru".
    expect(component).toContain("path.startsWith(BASE_URL)");
    expect(component).toContain('rest.startsWith("en/")');
    expect(component).not.toContain('path.includes("/en/")');
  });

  test("свойства cta_click — ровно те, что в контракте", () => {
    // Разбор самого литерала, а не поиск подстроки по файлу: «path» есть в
    // компоненте и без события, поэтому substring-проверка не падала бы никогда.
    const call = /track\("cta_click",\s*\{([^}]*)\}/.exec(component)?.[1];
    expect(call).toBeTruthy();
    const keys = call!.split(",").map((part) => part.split(":")[0].trim()).filter(Boolean);
    expect(keys.sort()).toEqual(["locale", "path", "surface", "target"]);
  });
});

describe("точки монтирования", () => {
  test("подвал монтирует записку на каждой странице", () => {
    expect(base).toContain("<CollabCta");
    // Вариантов больше нет: второй проп означал бы вторую поверхность.
    expect(base).not.toContain('variant="');
  });

  test("strip стоит до строки контактов", () => {
    const strip = base.indexOf("<CollabCta");
    const contacts = base.indexOf("site-footer__contacts");
    expect(strip).toBeGreaterThan(-1);
    expect(contacts).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(contacts);
  });

  test("страницы дней записку не монтируют", () => {
    // Записка одна и стоит в подвале — на всех страницах сразу. Если она снова
    // появится в теле дня, это будет второй блок с той же поверхностью в UTM.
    for (const [name, source] of [
      ["ru", dayRu],
      ["en", dayEn],
    ] as const) {
      expect(source, `страница дня ${name} монтирует записку второй раз`).not.toContain(
        "CollabCta",
      );
    }
  });
});

describe("темы и словарь", () => {
  test("ни одного литерального цвета: только токены", () => {
    expect(component).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(component).not.toMatch(/\brgba?\(/);
    expect(component).not.toMatch(/\bhsla?\(/);
    expect(component).not.toMatch(/\boklch\(/);
  });

  test("тексты есть в обоих языках и не совпадают", () => {
    for (const key of [
      "collabStripTitle",
      "collabStripLine",
      "collabPrimary",
      "collabSecondary",
    ] as const) {
      for (const lang of LANGS) expect(t(lang, key).length, `${lang}:${key}`).toBeGreaterThan(0);
      expect(t("ru", key)).not.toBe(t("en", key));
    }
  });
});
