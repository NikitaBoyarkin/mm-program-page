/**
 * Фон страницы и панель меню — утверждения из `docs/DECISIONS.md` §5, которые
 * до этого теста держались только прозой.
 *
 * 1. Порядок декоративных слоёв. `body::before`, `.ground-bloom` и
 *    `body::after` сидят на одном `z-index` (−1), поэтому рисуются в порядке
 *    дерева. Ramp непрозрачный: стоит его поставить на `::after` — и он
 *    закрашивает соты целиком (замер: 69 117 px расходится в кадре). Ни сборка,
 *    ни браузерные тесты этого не видят: страница остаётся валидной, просто без
 *    обоев.
 * 2. Панель меню идёт за темой экрана и держит контраст в каждой из трёх тем.
 *    Пока у `#site-nav` был блок локальных токенов, меню оставалось светлым
 *    во всех темах, а границы его контролов на тёмной панели не добирали до
 *    нормы WCAG 1.4.11 — и ничто не краснело.
 * 3. Перетекание земли: две замкнутые орбиты в противофазе, обе внутри
 *    оверскана. Орбита, вышедшая за запас, показывает край слоя — и вместо
 *    течения видно ползущую картинку; разомкнутый цикл даёт рывок на стыке.
 * 4. Свечение не съедает читаемость: на его пике `--text-muted` держит 4.5:1
 *    в каждой теме. Сила слоя — единственное число, которое двигает этот
 *    порог, поэтому она и проверяется расчётом, а не на глаз.
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

/** Кадры одного `@keyframes` по меткам: `from`, `25%`, `to` … Тело кадра
 *  нормализовано по пробелам, поэтому `from` и `to` сравнимы строкой. */
function keyframes(css: string, name: string): Record<string, string> {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) throw new Error(`нет @keyframes ${name}`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const frames: Record<string, string> = {};
  for (const match of block.matchAll(/(from|to|\d+%)\s*\{([^}]*)\}/g)) {
    frames[match[1]!.trim()] = match[2]!.replace(/\s+/g, " ").trim();
  }
  if (!frames.from || !frames.to) throw new Error(`@keyframes ${name}: нет from/to`);
  return frames;
}

/** Все радиусы орбиты в процентах — максимум по осям `translate3d`. */
function translations(frames: Record<string, string>): number[] {
  return Object.values(frames).map((frame) => {
    const values = frame.match(/translate3d\(([^)]*)\)/)?.[1];
    if (!values) throw new Error(`кадр без translate3d: ${frame}`);
    return Math.max(
      ...values
        .split(",")
        .slice(0, 2)
        .map((part) => Math.abs(Number.parseFloat(part))),
    );
  });
}

/** Значение `#rrggbb` токена внутри блока правил; `undefined` — токен не объявлен. */
function hex(css: string, name: string): string | undefined {
  return css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
}

const parse = (value: string): [number, number, number] => {
  const clean = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
};

/** Композит полупрозрачного слоя над подложкой — то, что видит глаз. */
const mix = (
  over: [number, number, number],
  under: [number, number, number],
  alpha: number,
): [number, number, number] => [
  over[0] * alpha + under[0] * (1 - alpha),
  over[1] * alpha + under[1] * (1 - alpha),
  over[2] * alpha + under[2] * (1 - alpha),
];

/** Относительная яркость WCAG 2.x. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов по WCAG 2.x. */
const contrast = (a: [number, number, number], b: [number, number, number]): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};


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
  for (const selector of ["body::before", ".ground-bloom", "body::after"]) {
    const rule = body(tokens, selector);
    expect(rule, `${selector}: слой обязан быть фиксированным`).toContain("position: fixed");
    expect(rule, `${selector}: слой обязан быть под контентом`).toContain("z-index: var(--z-decor)");
    expect(rule, `${selector}: слой не должен перехватывать клики`).toContain("pointer-events: none");
  }
});

/**
 * Перетекание земли (`tokens.css`, блок «Земля страницы»; порт `HomeNewTab.astro`
 * из портфолио). Три утверждения, которые держат именно тест, а не глаз:
 *
 * 1. Свет идёт МЕЖДУ рампой и сотами. Все три слоя на одном `z-index` (−1),
 *    порядок задан деревом, и свет поверх сот подкрашивал бы узор, а под
 *    рампой — исчезал бы целиком под непрозрачным градиентом.
 * 2. Обе орбиты замкнуты и не выходят за оверскан. `from` ≠ `to` даёт рывок на
 *    стыке цикла; радиус больше оверскана (`inset: -40%`, то есть 40 % экрана)
 *    вводит край слоя в кадр — и вместо перетекания видно ползущую картинку.
 * 3. Фазы противофазные. Две орбиты одного направления и одной скорости глаз
 *    читает как один лист, а не как течение.
 */
test("земля перетекает: рампа и свечение едут разными фазами", () => {
  expect(body(tokens, "body::before")).toContain("animation: ground-orbit 24s linear infinite");
  expect(body(tokens, ".ground-bloom")).toContain("animation: ground-bloom-orbit 34s linear infinite");

  // Оверскан: орбита живёт в запасе, а не в кадре.
  for (const selector of ["body::before", ".ground-bloom"]) {
    expect(body(tokens, selector), `${selector}: нет запаса под орбиту`).toContain("inset: -40%");
  }

  const ground = keyframes(tokens, "ground-orbit");
  const bloom = keyframes(tokens, "ground-bloom-orbit");

  for (const [name, frames] of [
    ["ground-orbit", ground],
    ["ground-bloom-orbit", bloom],
  ] as const) {
    expect(frames.from, `${name}: цикл разомкнут, на стыке рывок`).toBe(frames.to);
    // Радиус считается от размера слоя (180 % экрана): 40 % оверскана — это
    // 22.2 % слоя, поэтому 20 % проходят с запасом, а 22 % уже нет.
    expect(Math.max(...translations(frames)), `${name}: орбита выходит за оверскан`).toBeLessThanOrEqual(
      20,
    );
  }

  // Противофаза: на 25 % рампа ушла вправо, свечение — влево.
  expect(ground["25%"]).toContain("translate3d(20%, 0, 0)");
  expect(bloom["25%"]).toContain("translate3d(-20%, 0, 0)");
});

test("свечение стоит между рампой и сотами, а печать гасит все три слоя", () => {
  // Порядок в дереве — единственное, что задаёт порядок отрисовки при общем
  // `z-index`. Элемент объявлен в `Base.astro` первым ребёнком `body`.
  const layout = read("src/layouts/Base.astro");
  const bloomAt = layout.indexOf('class="ground-bloom"');
  expect(bloomAt, "нет узла .ground-bloom в каркасе").toBeGreaterThan(layout.indexOf("<body>"));
  expect(bloomAt, "свечение обязано идти до контента и до скип-ссылки").toBeLessThan(
    layout.indexOf('<a class="skip-link"'),
  );

  // Печать, forced-colors и «больше контраста» гасят декор целиком: свет на
  // белом листе — это пятно на бумаге.
  const decorStart = tokens.lastIndexOf("@media print, (forced-colors: active), (prefers-contrast: more)");
  expect(decorStart, "нет блока, гасящего декор").toBeGreaterThan(-1);
  const decor = tokens.slice(decorStart, tokens.indexOf("\n}", decorStart));
  for (const selector of ["body::before", ".ground-bloom", "body::after"]) {
    expect(decor, `декор не гаснет для ${selector}`).toContain(selector);
  }
  expect(decor).toContain("display: none");

  // И останавливается там, где читатель просил не двигать: глобальный блок
  // reduced-motion глушит любую анимацию, включая эти две орбиты.
  expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
});

/**
 * Свет — полупрозрачный акцент поверх земли, то есть он поднимает или опускает
 * яркость под текстом. Пик пятна — ровно `opacity` слоя, поэтому сила слоя
 * выбирается по контрасту `--text-muted` на самом светлом (dark, cyberpunk) и
 * самом тёмном (light) стопе рампы, а не на глаз. Числа в комментариях
 * `tokens.css` — те же, что считает этот тест: соврать в прозе он не даст.
 */
test("на пике свечения --text-muted держит 4.5:1 во всех трёх темах", () => {
  const themes = {
    dark: { root: ":root", selector: ".ground-bloom" },
    light: { root: '[data-theme="light"]', selector: '[data-theme="light"] .ground-bloom' },
    cyberpunk: {
      root: '[data-theme="cyberpunk"]',
      selector: '[data-theme="cyberpunk"] .ground-bloom',
    },
  } as const;

  for (const [theme, { root, selector }] of Object.entries(themes)) {
    // `:root` держит базовые токены, темы переопределяют только часть — поэтому
    // фолбэк на базовый блок, как это делает каскад.
    const base = body(tokens, ":root");
    const own = body(tokens, root);
    const token = (name: string) => hex(own, name) ?? hex(base, name);

    const muted = parse(token("--text-muted")!);
    const accent = parse(token("--text-accent")!);
    const opacity = Number(body(tokens, selector).match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(opacity, `${theme}: у слоя нет силы`).toBeGreaterThan(0);

    // Худший стоп рампы: тот, что даёт меньший контраст после засветки.
    const worst = ["--background-primary", "--background-secondary", "--card-background"]
      .map((name) => contrast(muted, mix(accent, parse(token(name)!), opacity)))
      .reduce((min, value) => Math.min(min, value));

    expect(worst, `${theme}: --text-muted на пике свечения`).toBeGreaterThanOrEqual(4.5);
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
