/**
 * Аналитика страницы программы: UTM-атрибуция и единственный канал в PostHog.
 *
 * Схема повторяет портфолио (`NikitaBoyarkin.github.io/src/lib/analytics.ts`),
 * чтобы оба сайта писали одинаковые свойства и читались одними тайлами:
 * `visit_utm_*` — кампания текущего визита, `first_utm_*` — первый заход,
 * `initial_referrer_class`, `landing_path`. Сверх схемы — `site`, по нему
 * тайлы отличают этот сайт от портфолио в общем проекте PostHog.
 *
 * Компоненты не читают глобальный `posthog` сами: только `track()`.
 */

export type UtmKey = "source" | "medium" | "campaign" | "content" | "term";
export type UtmParams = Partial<Record<UtmKey, string>>;
export type ReferrerClass = "linkedin" | "github" | "google" | "direct" | "other";

const UTM_KEYS: readonly UtmKey[] = ["source", "medium", "campaign", "content", "term"];

// Длиннее — реальный слаг кампании, короче — вставленное эссе или макрос
// рекламной системы, который породит тысячу почти одинаковых строк в разбивке.
const UTM_MAX = 100;

/** Признак сайта в общем проекте PostHog. */
export const SITE = "mm-program-page";

/**
 * Пять UTM-параметров из query-строки.
 *
 * Регистр и разделители сохраняются намеренно: ссылку уже нормализовал
 * `/utm-tags` при сборке, и вторая нормализация здесь развела бы значение
 * на сайте с отчётом площадки.
 */
export function parseUtm(search: string): UtmParams {
  const out: UtmParams = {};
  if (!search) return out;
  const params = new URLSearchParams(search);
  for (const key of UTM_KEYS) {
    const raw = params.get(`utm_${key}`);
    if (!raw) continue;
    const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, UTM_MAX);
    if (value) out[key] = value;
  }
  return out;
}

/** Сузить произвольное значение из хранилища до пяти разрешённых ключей. */
function readUtm(value: unknown): UtmParams {
  const out: UtmParams = {};
  if (!value || typeof value !== "object") return out;
  for (const key of UTM_KEYS) {
    const stored = (value as Record<string, unknown>)[key];
    if (typeof stored === "string" && stored) out[key] = stored;
  }
  return out;
}

/**
 * `{ first_utm_source: "linkedin", … }` — все пять ключей каждый раз, `null`
 * когда визит ничего не принёс, чтобы схема свойств в PostHog не прыгала.
 */
function utmSuperProperties(
  prefix: "first_utm" | "visit_utm",
  utm: UtmParams,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of UTM_KEYS) out[`${prefix}_${key}`] = utm[key] ?? null;
  return out;
}

/** Класс первого источника — множество то же, что у портфолио. */
export function classifyReferrer(referrer: string | null | undefined): ReferrerClass {
  if (!referrer) return "direct";
  const r = referrer.toLowerCase();
  if (r === "$direct" || r === "direct") return "direct";
  if (r.includes("linkedin.")) return "linkedin";
  if (r.includes("github.")) return "github";
  if (r.includes("google.")) return "google";
  return "other";
}

export interface FirstTouch {
  referrer_class: ReferrerClass;
  landing_path: string;
  utm: UtmParams;
}

const REFERRER_CLASSES: ReadonlySet<string> = new Set([
  "linkedin",
  "github",
  "google",
  "direct",
  "other",
]);

function isReferrerClass(value: unknown): value is ReferrerClass {
  return typeof value === "string" && REFERRER_CLASSES.has(value);
}

/** Первый заход по сырому referrer'у и пути входа. Чистая функция. */
export function computeFirstTouch(
  referrer: string,
  pathname: string,
  search = "",
): FirstTouch {
  let domain = "";
  if (referrer) {
    try {
      domain = new URL(referrer).hostname;
    } catch {
      domain = "";
    }
  }
  return {
    referrer_class: classifyReferrer(domain),
    landing_path: pathname,
    utm: parseUtm(search),
  };
}

const FIRST_TOUCH_KEY = "mm_ph_first_touch";
const VISIT_UTM_KEY = "mm_ph_visit_utm";

function store(kind: "session" | "local"): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readFirstTouch(s: Storage | null): FirstTouch | null {
  if (!s) return null;
  try {
    const raw = s.getItem(FIRST_TOUCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirstTouch>;
    if (typeof parsed.landing_path !== "string") return null;
    return {
      // В хранилище уже лежит класс, а не хост. Прогонять его через
      // `classifyReferrer` снова нельзя: "linkedin" не содержит "linkedin."
      // и схлопнулся бы в "other" на каждой загрузке после первой.
      referrer_class: isReferrerClass(parsed.referrer_class)
        ? parsed.referrer_class
        : "other",
      landing_path: parsed.landing_path,
      utm: readUtm(parsed.utm),
    };
  } catch {
    return null;
  }
}

function writeFirstTouch(s: Storage | null, value: FirstTouch): void {
  if (!s) return;
  try {
    s.setItem(FIRST_TOUCH_KEY, JSON.stringify(value));
  } catch {
    // Приватный режим или квота — живём без сохранения.
  }
}

/**
 * Первый заход: считается один раз и больше не перезаписывается
 * (sessionStorage с запасным localStorage).
 */
export function firstTouch(): FirstTouch {
  const session = store("session");
  const local = store("local");
  const existing = readFirstTouch(session) ?? readFirstTouch(local);
  if (existing) return existing;

  const value = computeFirstTouch(
    document.referrer || "",
    window.location.pathname,
    window.location.search,
  );
  writeFirstTouch(session, value);
  writeFirstTouch(local, value);
  return value;
}

function readVisitUtm(s: Storage | null): UtmParams | null {
  if (!s) return null;
  try {
    const raw = s.getItem(VISIT_UTM_KEY);
    if (!raw) return null;
    const parsed = readUtm(JSON.parse(raw));
    return Object.keys(parsed).length ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * UTM текущего визита, живут в sessionStorage.
 *
 * Пишутся при первом визите с разметкой и дальше не перезаписываются: переход
 * вглубь или на неразмеченную страницу не должен стирать кампанию, которая
 * привела человека. Новая вкладка стартует пустой.
 */
export function visitUtm(): UtmParams {
  const session = store("session");
  const stored = readVisitUtm(session);
  if (stored) return stored;

  const fresh = parseUtm(window.location.search);
  if (session && Object.keys(fresh).length) {
    try {
      session.setItem(VISIT_UTM_KEY, JSON.stringify(fresh));
    } catch {
      // Приватный режим или квота.
    }
  }
  return fresh;
}

export interface PostHogLike {
  register(props: Record<string, unknown>): void;
  capture(event: string, props?: Record<string, unknown>): void;
}

let ph: PostHogLike | null = null;

/**
 * События, отправленные до загрузки SDK. Их два источника: `?talk=<id>`
 * открывает модалку без единого клика, а SDK стартует только по первому
 * взаимодействию. Без очереди такой показ доклада терялся бы целиком.
 */
const QUEUE_MAX = 25;
const queued: Array<{ event: string; props: Record<string, unknown> }> = [];

/** Передать инициализированный экземпляр PostHog модулю (зовёт Analytics.astro). */
export function attachPosthog(instance: PostHogLike): void {
  ph = instance;
}

function flushQueue(): void {
  if (!ph) return;
  for (const item of queued.splice(0)) {
    try {
      ph.capture(item.event, item.props);
    } catch {
      // Молча: сломанный транспорт не должен ронять обработчик клика.
    }
  }
}

/** Событие в PostHog. Никогда не бросает: аналитика не ломает страницу. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  if (!ph) {
    if (queued.length < QUEUE_MAX) queued.push({ event, props });
    return;
  }
  try {
    ph.capture(event, props);
  } catch {
    // Молча: сломанный транспорт не должен ронять обработчик клика.
  }
}

export type LinkKind = "social" | "ticket" | "portfolio" | "source" | "other";

export interface LinkTarget {
  /** Стабильный слаг для разбивки: у одного спикера и один, и второй клик — та же строка. */
  link: string;
  kind: LinkKind;
  /** Сеть спикера для `social:*`; у остальных `null`. */
  network: string | null;
}

const SOCIAL_CLASS = /\bsocial-link--([a-z]+)\b/;

/**
 * Что за ссылку открыли — по разметке, хосту и UTM. Чистая функция: тайл
 * «топ ссылок» группирует по `link`, поэтому слаг не должен содержать
 * query-мусор и не должен зависеть от порядка карточек на странице.
 *
 * `utm_content` проверяется раньше хоста: ссылки в портфолио живут на том же
 * домене, что и сайт, и по хосту неотличимы от внутренних.
 */
export function classifyLink(input: {
  className?: string;
  hostname: string;
  pathname: string;
  utmContent?: string | null;
}): LinkTarget {
  const social = SOCIAL_CLASS.exec(input.className ?? "");
  if (social) {
    return { link: `social:${social[1]}`, kind: "social", network: social[1] };
  }
  if (input.utmContent) {
    return { link: `portfolio:${input.utmContent}`, kind: "portfolio", network: null };
  }
  if (input.hostname === "matemarketing.ru" && input.pathname.startsWith("/tickets")) {
    return { link: "ticket", kind: "ticket", network: null };
  }
  if (input.hostname === "lms.matemarketing.ru") {
    return { link: "source", kind: "source", network: null };
  }
  return { link: `${input.hostname}${input.pathname}`, kind: "other", network: null };
}

/**
 * Зарегистрировать супер-свойства — один раз за загрузку страницы,
 * сразу после `posthog.init()`.
 *
 * Супер-свойства, а не свойства события: клик по билету и любой другой CTA
 * обязан нести кампанию тоже. Автозахват PostHog кладёт UTM только в
 * `$pageview`, поэтому отчёты по кампаниям без регистрации разваливаются.
 */
export function registerSuperProperties(): void {
  if (!ph) return;

  const touch = firstTouch();
  const visit = visitUtm();

  try {
    ph.register({
      site: SITE,
      initial_referrer_class: touch.referrer_class,
      landing_path: touch.landing_path,
      ...utmSuperProperties("first_utm", touch.utm),
      ...utmSuperProperties("visit_utm", visit),
    });
  } catch {
    // Не ломаем init.
  }

  // Только здесь: до `register` у накопленных событий не было бы `site` и UTM.
  flushQueue();
}
