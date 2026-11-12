/**
 * Словарь тем программы: классификатор, подписи и короткие формы для графа.
 *
 * Модуль выделен из `talks-graph.ts` по шву: это единственная часть модели,
 * которая ничего не знает о докладах как об узлах, — только о тексте и словаре.
 * Поэтому словарь можно править, не задевая сеть заметок.
 *
 * Классификатор один на обе локали: темы считаются по русскому тексту даже на
 * `/en/`, переводится только подпись. Двухбуквенный латинский стем (`bi`, `ab`)
 * сравнивается с целым токеном — иначе `bi` цепляется за `bigtech-масштабе`.
 */
import type { Talk } from "./program-core";

/* ── Темы ────────────────────────────────────────────────────────────────────
   Словарь и его стемы проверены на портфолио (там граф строится из этого же
   слепка): префиксное совпадение поглощает русскую флексию, а двухбуквенный
   латинский стем (`bi`, `ab`) сравнивается с целым токеном — иначе `bi`
   цепляется за `bigtech-масштабе` и красит инженерный доклад в BI. */

export interface Theme {
  id: string;
  label: string;
  labelEn: string;
  /** Короткая подпись для кольца графа: 11 полных названий физически не
   *  влезают на окружность внутреннего кольца (11 × ~190 px против ~800 px).
   *  Полное имя остаётся в `<title>` узла и в заголовке хаба темы ниже. */
  short: string;
  shortEn: string;
  stems: string[];
}

export const THEMES: Theme[] = [
  { id: "ai", label: "AI и агенты", labelEn: "AI & agents", short: "AI", shortEn: "AI", stems: ["ai", "ии", "агент", "llm", "gpt", "нейросет", "промпт", "автономн"] },
  { id: "metrics", label: "Метрики", labelEn: "Metrics", short: "Метрики", shortEn: "Metrics", stems: ["метрик", "kpi", "показател"] },
  { id: "ab", label: "A/B и эксперименты", labelEn: "A/B & experiments", short: "A/B", shortEn: "A/B", stems: ["a-b", "ab", "эксперимент", "aa-тест", "aa"] },
  { id: "bi", label: "BI и дашборды", labelEn: "BI & dashboards", short: "BI", shortEn: "BI", stems: ["bi", "дашборд", "dashboard", "datalens", "metabase", "redash", "визуализац", "superset"] },
  { id: "dataeng", label: "Данные и инженерия", labelEn: "Data engineering", short: "Данные", shortEn: "Data", stems: ["airflow", "dbt", "etl", "elt", "пайплайн", "хранилищ", "clickhouse", "sql", "озер", "каталог"] },
  { id: "marketing", label: "Маркетинг и реклама", labelEn: "Marketing & ads", short: "Маркетинг", shortEn: "Ads", stems: ["реклам", "маркетинг", "кампани", "cpa", "romi", "атрибуци", "медиамикс", "спрос"] },
  { id: "hr", label: "HR и команда", labelEn: "HR & team", short: "HR", shortEn: "HR", stems: ["найм", "hr", "кандидат", "собеседован", "онбординг", "тимлид", "команд", "испытательн", "джун"] },
  { id: "causal", label: "Причинный вывод", labelEn: "Causal inference", short: "Причинность", shortEn: "Causal", stems: ["причинн", "causal", "uplift", "инкрементальн", "psm", "синтетическ", "whydra"] },
  { id: "retention", label: "Retention и LTV", labelEn: "Retention & LTV", short: "Retention", shortEn: "Retention", stems: ["retention", "удержан", "отток", "когорт", "ltv", "churn"] },
  { id: "product", label: "Продукт и гипотезы", labelEn: "Product & discovery", short: "Продукт", shortEn: "Product", stems: ["продукт", "гипотез", "роадмап", "кастдев", "исследован", "дискавери"] },
  { id: "security", label: "Безопасность и приватность", labelEn: "Security & privacy", short: "Приватность", shortEn: "Privacy", stems: ["безопасн", "приватн", "pii", "шифрован", "атак", "уязвим"] },
];

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

/** Слово целиком: дефис остаётся частью токена, `a-b` — тоже тема.
 *  `A/B` сначала склеивается в `ab`: слэш разделителем не является, но
 *  без склейки «A/B-тест» распадался на `a` и `b-тест` и тема экспериментов
 *  теряла ровно те доклады, которые называют её так, как пишут на слайдах. */
function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/a\s*\/\s*b/g, "ab")
    .split(/[^a-zа-яё0-9/-]+/u)
    .filter(Boolean);
}

function matchesStem(token: string, stem: string): boolean {
  return stem.length <= 2 && /^[a-z]/.test(stem)
    ? token === stem || token.startsWith(`${stem}-`)
    : token.startsWith(stem);
}

/** Темы доклада. Считаются по русскому тексту даже для `en/`: словарь тем
 *  один, а перевод темы — подпись, не второй классификатор. */
export function themesOf(talk: Pick<Talk, "title" | "short" | "description">): string[] {
  const tokens = tokenize(`${talk.title} ${talk.short ?? ""} ${talk.description ?? ""}`);
  return THEMES.filter((theme) => tokens.some((token) => theme.stems.some((stem) => matchesStem(token, stem)))).map(
    (theme) => theme.id,
  );
}

export function themeLabel(id: string, lang: "ru" | "en"): string {
  const theme = THEME_BY_ID.get(id);
  return theme ? (lang === "en" ? theme.labelEn : theme.label) : id;
}

/** Короткая подпись для графа: полная живёт в `<title>` и в заголовке хаба. */
export function themeShortLabel(id: string, lang: "ru" | "en"): string {
  const theme = THEME_BY_ID.get(id);
  return theme ? (lang === "en" ? theme.shortEn : theme.short) : id;
}
