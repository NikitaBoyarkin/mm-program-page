/**
 * Атрибуция: чем размечена ссылка и что за ссылку открыли.
 *
 * Вынесено из `analytics.ts`, чтобы карта событий и транспорт не тянули за
 * собой разметку: `analytics.ts` реэкспортирует всё отсюда, поэтому импорты
 * снаружи не изменились.
 */

/** Признак сайта в общем проекте PostHog. */
export const SITE = "mm-program-page";

/** Корень портфолио: переходы в него размечены, иначе визит читается прямым. */
export const PORTFOLIO_ORIGIN = "https://nikitaboyarkin.github.io";

/**
 * Внешняя ссылка с UTM этого сайта.
 *
 * `content` — поверхность: то же значение уходит в `surface` события, поэтому
 * срез по кампании и срез по поверхности читаются одним словарём, а не двумя.
 */
export function utmHref(
  href: string,
  { medium = "referral", campaign, content }: {
    medium?: string;
    campaign: string;
    content: string;
  },
): string {
  const url = new URL(href);
  url.searchParams.set("utm_source", SITE);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", content);
  return url.toString();
}

/** Переход в портфолио: одна строка разметки на все его ссылки. */
export function portfolioHref(path: string, content: string): string {
  return utmHref(`${PORTFOLIO_ORIGIN}${path}`, {
    campaign: "mm_program_to_portfolio",
    content,
  });
}

/**
 * Откуда пришли в заметку доклада. Выдача поиска ставит `?from=search`,
 * остальное решает referrer: без этого поля поиск, граф и модалка складывались
 * в одну строку, и «читатели из поиска» были невидимы.
 */
export type TalkNoteSurface = "search" | "program" | "talks" | "talk" | "external" | "direct";

/** Чистая функция: `from` важнее referrer'а — выдача поиска и есть источник. */
export function classifyNoteEntry(
  referrer: string,
  from: string | null,
  currentOrigin: string,
): TalkNoteSurface {
  if (from === "search") return "search";
  if (!referrer) return "direct";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "external";
  }
  if (url.origin !== currentOrigin) return "external";
  // `talk/` раньше `talks`: заметка со страницы графа несёт `/talks/`, а
  // заметка-соседка — `/talk/<id>/`, и порядок различает их без второго поля.
  if (url.pathname.includes("/talk/")) return "talk";
  if (url.pathname.includes("/talks")) return "talks";
  return "program";
}

export type LinkKind = "social" | "ticket" | "portfolio" | "source" | "cta" | "other";

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
 *
 * CTA на сотрудничество тоже размечен UTM — с `utm_content`, потому что без
 * него бронь из новой сессии читается как прямой заход. Отличить его от
 * перехода в портфолио можно только по `utm_medium=cta`; без этой ветки клик
 * по кнопке «обсудить проект» попадал бы в тайл «переходы в портфолио» и
 * завышал единственную метрику, ради которой размечен весь остальной сайт.
 */
export function classifyLink(input: {
  className?: string;
  hostname: string;
  pathname: string;
  utmContent?: string | null;
  utmMedium?: string | null;
  /** `data-cta-target` самой ссылки: единственный признак, который есть у обеих кнопок CTA. */
  ctaTarget?: string | null;
}): LinkTarget {
  const social = SOCIAL_CLASS.exec(input.className ?? "");
  if (social) {
    return { link: `social:${social[1]}`, kind: "social", network: social[1] };
  }
  // Разметка CTA, а не URL: у кнопки Telegram нет UTM (query `t.me` уходит в
  // текст сообщения), и без этой ветки она классифицировалась бы как `other`,
  // а тайл «клики по CTA» считал бы только календарь.
  if (input.ctaTarget) {
    return { link: `cta:${input.utmContent || input.ctaTarget}`, kind: "cta", network: null };
  }
  if (input.utmMedium === "cta" && input.utmContent) {
    return { link: `cta:${input.utmContent}`, kind: "cta", network: null };
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
