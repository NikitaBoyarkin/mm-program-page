/**
 * Фон страницы и панель меню — два утверждения из `docs/DECISIONS.md` §5,
 * которые до этого теста держались только прозой.
 *
 * 1. Порядок декоративных слоёв. `body::before` и `body::after` сидят на одном
 *    `z-index` (−1), поэтому рисуются в порядке дерева. Ramp непрозрачный:
 *    стоит его поставить на `::after` — и он закрашивает соты целиком (замер:
 *    69 117 px расходится в кадре). Ни сборка, ни браузерные тесты этого не
 *    видят: страница остаётся валидной, просто без обоев.
 * 2. Панель меню идёт за темой экрана и держит контраст в каждой из трёх тем.
 *    Пока у `#site-nav` был блок локальных токенов, меню оставалось светлым
 *    во всех темах, а границы его контролов на тёмной панели не добирали до
 *    нормы WCAG 1.4.11 — и ничто не краснело.
 *
 * Разбор CSS: комментарии вырезаются до разбора, поэтому закомментированная
 * строка не может удовлетворить проверку. Правила ищутся по ВСЕМУ файлу, а не
 * только по первому совпадению: вернуть оверрайд можно вторым блоком
 * `#site-nav` или правилом вида `html[data-theme="dark"] #site-nav`.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

const read = (file: string) =>
  readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const tokens = read("src/styles/tokens.css");
const site = read("src/styles/site.css");
const program = read("src/styles/program.css");

interface Rule {
  selector: string;
  body: string;
}

/** Все правила файла: селектор и тело. Вложенные в медиазапросы ловятся тоже —
 *  внутреннее правило всегда имеет вид `селектор { тело без скобок }`. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().split("\n").pop()?.trim() ?? "";
    if (!selector || selector.startsWith("@")) continue;
    out.push({ selector, body: match[2] });
  }
  return out;
}

function body(css: string, selector: string): string {
  const found = rules(css).find((rule) => rule.selector === selector);
  if (!found) throw new Error(`нет правила ${selector}`);
  return found.body;
}

test("ramp лежит в body::before, а маска сот — в body::after", () => {
  const before = body(tokens, "body::before");
  const after = body(tokens, "body::after");

  // Непрозрачный слой страницы — первый, иначе он закрасит соты.
  expect(before).toContain("var(--gradient-page)");
  expect(before).not.toContain("mask-image");

  // Соты — второй: маска + цвет отдельным токеном.
  expect(after).toContain("var(--wallpaper-tile)");
  expect(after).toContain("var(--wallpaper-line)");
  expect(after).not.toContain("var(--gradient-page)");
});

test("оба декоративных слоя не ловят клики и не поднимаются над контентом", () => {
  for (const selector of ["body::before", "body::after"]) {
    const rule = body(tokens, selector);
    expect(rule, `${selector}: слой обязан быть фиксированным`).toContain("position: fixed");
    expect(rule, `${selector}: слой обязан быть под контентом`).toContain("z-index: var(--z-decor)");
    expect(rule, `${selector}: слой не должен перехватывать клики`).toContain("pointer-events: none");
  }
});

test("ни одно правило с #site-nav не переопределяет токены темы", () => {
  const panelRules = [...rules(site), ...rules(program)].filter((rule) =>
    rule.selector.includes("#site-nav"),
  );
  expect(panelRules.length, "панель должна быть объявлена хотя бы раз").toBeGreaterThan(0);
  for (const rule of panelRules) {
    // Единственный способ снова сделать панель «светлой всегда» — вернуть
    // локальные токены. Ловим в любом правиле, а не только в первом.
    expect(rule.body, `${rule.selector}: локальное переопределение токена`).not.toMatch(
      /(^|\n|;|\s)--[a-z-]+\s*:/,
    );
  }
  expect(body(site, "#site-nav")).toContain("background: var(--card-background)");
});

test("ребро панели и границы её контролов держат норму 3:1 в киберпанке", () => {
  // Ребро — то, что отделяет панель от страницы в теме, где заливки совпадают.
  expect(body(site, "#site-nav")).toContain("border-inline-end: 1px solid var(--border-strong)");

  // #4a4a57 на панели #232327 = 1.79:1; #6f6f80 = 3.18:1 (норма 1.4.11 — 3:1).
  for (const selector of [".drawer-foot .drawer-favs", ".drawer-foot button"]) {
    expect(body(site, selector), `${selector}: рамка контрола обязана быть --border-strong`).toContain(
      "border: 1px solid var(--border-strong)",
    );
  }
});

test("ховер пункта меню не совпадает с фоном панели", () => {
  // В тёмной теме --interactive-hover равен --card-background, то есть фону
  // панели: подложка исчезала. Работает нейтральная примесь --text-normal.
  const hover = body(site, ".drawer-link:hover");
  expect(hover).not.toContain("var(--interactive-hover)");
  expect(hover).toContain("color-mix(in srgb, var(--text-normal)");
});
