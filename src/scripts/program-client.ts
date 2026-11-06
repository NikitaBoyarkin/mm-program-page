/**
 * Клиентский слой страницы программы — единственный JS, который уезжает в браузер.
 *
 * Разметку, сетку и стили рисует Astro на билде, поэтому здесь нет ни рендера
 * карточек, ни раскладки: только поведение, которому нужен пользователь, —
 * переключатель темы, drawer, фильтры (трек и избранное), «Подробнее»,
 * модалка доклада и экспорт `.ics`.
 *
 * Данные (`Program`) приходят из prerendered-эндпоинта `<локаль>/program.json`
 * лениво — только при первом открытии модалки, поиске или экспорте календаря.
 * Промис мемоизирован, ошибка показывается тостом; в консоль не пишем ничего.
 */
import { pluralTalks } from "../i18n/format";
import { dayHrefFor } from "../i18n/paths";
import { t, type Lang } from "../i18n/ui";
import { buildCalendar, calendarFilename, downloadIcs } from "../lib/ics";
import {
  BASE_URL,
  DATE_RE,
  formatRange,
  imageUrl,
  isTime,
  type Day,
  type Program,
  type Talk,
} from "../lib/program-core";
import { searchTalks } from "../lib/search";
import { THEMES, THEME_COLORS, THEME_ICONS, nextTheme, type Theme } from "../lib/theme";
import { SOCIAL_LABELS } from "../lib/socials";
import { createMorph } from "morphicons/dom";

/* ── Константы контракта ───────────────────────────────────────────── */

const THEME_KEY = "theme";
const FAV_KEY = "mm-program:favorites";
/** Фильтр «только избранное» — выбор экрана, а не данные: живёт в sessionStorage. */
const FAV_FILTER_KEY = "mm-program:favorites-only";
const TOAST_MS = 2500;

/** Класс скелетона области постера, пока грузится картинка из чужого CDN. */
const SKELETON_CLASS = "talk-modal__media--loading";

/** Порог мобильной модели (см. `CONTRACT.md`): список, а не сжатая сетка. */
const MOBILE_QUERY = "(max-width: 767.98px)";

/** Язык страницы ставит `Base.astro` в `data-lang`; прочее — русский. */
const LANG: Lang = document.documentElement.dataset.lang === "en" ? "en" : "ru";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ── Мелкие помощники ──────────────────────────────────────────────── */

const $ = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

const $$ = <T extends Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

/**
 * Внешние картинки приходят из чужого API: пропускаем только `https`,
 * чтобы поле из данных не стало beacon'ом на произвольный хост.
 */
function safeUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function readStorage(key: string, kind: "local" | "session" = "local"): string | null {
  try {
    const storage = kind === "session" ? window.sessionStorage : window.localStorage;
    return storage.getItem(key);
  } catch {
    return null; // приватный режим — живём без сохранения
  }
}

function writeStorage(key: string, value: string, kind: "local" | "session" = "local"): void {
  try {
    const storage = kind === "session" ? window.sessionStorage : window.localStorage;
    storage.setItem(key, value);
  } catch {
    // приватный режим / переполнение — молча, состояние остаётся в памяти
  }
}

function toast(message: string): void {
  for (const node of $$(".mm-toast")) node.remove();
  const node = document.createElement("div");
  node.className = "mm-toast";
  node.setAttribute("role", "status");
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), TOAST_MS);
}

/* ── 1. Тема: dark → light → cyberpunk → dark ──────────────────────── */

function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  const meta = $<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
  if (persist) writeStorage(THEME_KEY, theme);
}

/**
 * Иконки трёх тем живут в `src/lib/theme.ts` (`THEME_PATHS` / `THEME_ICONS`):
 * один источник для разметки, морфа и фолбэка без клиентского скрипта.
 * `IconNode` — стабильная ссылка, поэтому `morphicons` кеширует разбор и план;
 * сырая `d`-строка шла бы мимо обоих `WeakMap` и пересобирала план на каждый клик.
 */
/** Живые морфы тумблеров: их два (шапка и drawer), путь у обоих один. */
const themeMorphs: Array<ReturnType<typeof createMorph>> = [];

function initTheme(): void {
  const stored = readStorage(THEME_KEY);
  const rendered = document.documentElement.dataset.theme;
  const theme: Theme = isTheme(stored) ? stored : isTheme(rendered) ? rendered : "dark";
  applyTheme(theme, false);

  // Первая иконка ставится без анимации: сохранённая тема сразу получает свою
  // иконку, а не луну из разметки. Без JS разметка остаётся прежней.
  for (const path of $$<SVGPathElement>("[data-theme-toggle] path")) {
    themeMorphs.push(createMorph(path, THEME_ICONS[theme], { reducedMotion: "user" }));
  }

  // Тумблеров два — в шапке и в drawer'е (`Nav.astro`). Один делегированный
  // слушатель обслуживает оба: два обработчика на одну кнопку проматывали бы
  // тему через шаг, поэтому на каждой кнопке отдельного подписчика нет.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-theme-toggle]")) return;
    const current = document.documentElement.dataset.theme;
    const next = nextTheme(isTheme(current) ? current : "dark");
    applyTheme(next, true);
    for (const morph of themeMorphs) morph.morphTo(THEME_ICONS[next]);
  });
}

/* ── 1a. История браузера: системная «Назад» закрывает слой ────────── */

/**
 * Модалка и drawer — верхние слои, и оба живут в истории отдельной записью:
 * `pushState` при открытии, `popstate` — сигнал «пользователь нажал Назад,
 * закрой слой». Пользовательское закрытие прячет слой сразу и только потом
 * отматывает запись, убедившись, что она наша, поэтому два быстрых `Esc` не
 * делают два `history.back()`. Маркер `mmLayerToken` в state отвечает на
 * вопрос «эта запись — моя?»: если записи нет (рассинхрон истории,
 * `pushState` упал), `back()` не вызывается и со страницы не выкидывает.
 */
type LayerName = "modal" | "drawer" | "search";

let layerSeq = 0;
let modalLayerToken = "";
let drawerLayerToken = "";
let searchLayerToken = "";
/** Отложенный возврат фокуса в только что открытый drawer (см. `openDrawer`). */
let focusTimer = 0;
/** Снятие `transitionend`-слушателя drawer: закрытие до 260 мс иначе течёт. */
let drawerCleanup: (() => void) | null = null;

function currentLayerToken(): string {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object") return "";
  const token = (state as Record<string, unknown>).mmLayerToken;
  return typeof token === "string" ? token : "";
}

/** Возвращает маркер записи или `""`, если History API недоступен. */
function pushLayer(layer: LayerName): string {
  const token = `${layer}-${++layerSeq}`;
  try {
    const base: unknown = window.history.state;
    const state =
      base && typeof base === "object"
        ? { ...(base as Record<string, unknown>), mmLayerToken: token }
        : { mmLayerToken: token };
    window.history.pushState(state, "");
    return token;
  } catch {
    return "";
  }
}

function initHistory(): void {
  window.addEventListener("popstate", () => {
    const token = currentLayerToken();
    // Слой закрывается только если запись действительно ушла: чужой
    // `popstate` (например, от `?track=` в другой записи) ничего не трогает.
    // Поиск — самый верхний слой, поэтому проверяется первым.
    if (searchLayerToken && searchLayerToken !== token) {
      hideSearch();
      return;
    }
    if (modalLayerToken && modalLayerToken !== token) {
      hideModal();
      return;
    }
    if (drawerLayerToken && drawerLayerToken !== token) hideDrawer(true);
  });
}

/* ── Инертный фон для слоёв (drawer, поиск) ─────────────────────────── */
/**
 * `aria-modal="true"` и фокус-трап держат Tab, но не виртуальный курсор
 * скринридера: Safari/VoiceOver продолжают читать страницу за скримом.
 * `inert` + `aria-hidden` убирают фон из дерева доступности целиком —
 * ровно то, что `TalkModal.astro` делает для модалки доклада.
 *
 * Записи хранят прежнее состояние: закрытая панель drawer'а либо инертна из
 * инлайнового фолбэка в `Base.astro`, либо просто `visibility: hidden`
 * (на страницах дня), и снимать чужой `inert` на закрытии поиска нельзя.
 *
 * `keep` — поддерево открытого слоя; всё, что его содержит, не инертится,
 * иначе диалог оказался бы внутри инертного `main` и потерял фокус.
 * `.nav-scrim` не инертится никогда: это тап-зона закрытия drawer'а.
 */
type InertRecord = { el: Element; inert: boolean; ariaHidden: string | null };

const inertApplied: InertRecord[] = [];

function inertBackground(keep: Element | null): void {
  // Слой поверх слоя сегодня недостижим (открывашка поиска живёт в шапке,
  // а шапка инертна при открытом drawer'е), но молча игнорировать `keep`
  // нельзя: снимаем прошлый набор и применяем новый.
  if (inertApplied.length) releaseInert();
  const targets: Element[] = $$(
    "body > a.skip-link, body > header, body > nav, body > footer",
  );
  const main = $("#main");
  if (main) {
    for (const child of Array.from(main.children)) {
      if (!keep || !child.contains(keep)) targets.push(child);
    }
  }
  for (const el of targets) {
    if (keep && (el === keep || el.contains(keep))) continue;
    inertApplied.push({
      el,
      inert: el.hasAttribute("inert"),
      ariaHidden: el.getAttribute("aria-hidden"),
    });
    el.setAttribute("inert", "");
    // Фолбэк для движков без `inert`: скринридер не должен читать фон.
    el.setAttribute("aria-hidden", "true");
  }
}

function releaseInert(): void {
  while (inertApplied.length) {
    const item = inertApplied.pop();
    if (!item) break;
    if (!item.inert) item.el.removeAttribute("inert");
    if (item.ariaHidden === null) item.el.removeAttribute("aria-hidden");
    else item.el.setAttribute("aria-hidden", item.ariaHidden);
  }
}

/* ── 2. Drawer ─────────────────────────────────────────────────────── */

function drawerTrigger(): HTMLButtonElement | null {
  return $<HTMLButtonElement>("button[data-nav-open]");
}

function openDrawer(): void {
  const nav = $("nav#site-nav");
  document.body.classList.add("nav-open");
  const trigger = drawerTrigger();
  trigger?.setAttribute("aria-expanded", "true");
  trigger?.setAttribute("aria-label", t(LANG, "navClose"));
  // `inert` убирает панель из таб-порядка и дерева доступности — то же, что
  // делает инлайновый фолбэк в `Base.astro` для страниц без этого скрипта.
  nav?.removeAttribute("inert");
  // Обратная сторона: страница за скримом уходит из таб-порядка и дерева
  // доступности, иначе Tab после последнего пункта уводил в невидимый `main`.
  inertBackground(nav);
  // Панель въезжает 220ms, и всё это время `visibility` остаётся `hidden`:
  // `focus()` по невидимому узлу молча не срабатывает (проверено замером:
  // activeElement оставался `body` и через 500ms). Ждём `transitionend`
  // по `visibility`, а таймаут страхует случай `prefers-reduced-motion`,
  // где перехода нет вовсе.
  const focusFirst = (): void => nav?.querySelector<HTMLElement>("a, button")?.focus();
  if (nav) {
    let focused = false;
    const settle = (): void => {
      // Панель могли закрыть раньше, чем сработал таймаут: фокус в закрытую
      // (и уже инертную) панель — это украденный фокус у кнопки-открывашки.
      if (focused || !document.body.classList.contains("nav-open")) return;
      focused = true;
      window.clearTimeout(focusTimer);
      drawerCleanup?.();
      drawerCleanup = null;
      focusFirst();
    };
    const onTransitionEnd = (event: Event): void => {
      if (event.target === nav && (event as TransitionEvent).propertyName === "visibility") settle();
    };
    nav.addEventListener("transitionend", onTransitionEnd);
    // Слушатель обязан сниматься и при закрытии до конца перехода, иначе
    // каждый быстрый open/close оставлял бы замыкание с ссылкой на `nav`.
    drawerCleanup = () => nav.removeEventListener("transitionend", onTransitionEnd);
    focusTimer = window.setTimeout(settle, 260);
  }
  // Упрощённая версия приёма из модалки: запись в истории, чтобы системная
  // «Назад» закрывала меню, а не уводила со страницы.
  if (!drawerLayerToken && document.body.classList.contains("nav-open")) {
    drawerLayerToken = pushLayer("drawer");
  }
}

/** Скрытие без истории: сам слой и его маркер, фокус — по флагу. */
function hideDrawer(returnFocus = true): void {
  const wasOpen = document.body.classList.contains("nav-open");
  document.body.classList.remove("nav-open");
  drawerLayerToken = "";
  // Ожидающий возврат фокуса из `openDrawer` больше не нужен.
  window.clearTimeout(focusTimer);
  drawerCleanup?.();
  drawerCleanup = null;
  // Снять `inert` с фона нужно ДО возврата фокуса: `focus()` внутри инертного
  // поддерева молча не срабатывает. И до выхода по отсутствующей кнопке —
  // иначе фон остался бы инертным до перезагрузки.
  releaseInert();
  const trigger = drawerTrigger();
  if (!trigger) return;
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", t(LANG, "navOpen"));
  $("nav#site-nav")?.setAttribute("inert", "");
  if (wasOpen && returnFocus) trigger.focus();
}

/**
 * Пользовательское закрытие: слой скрывается сразу, а история отматывается
 * вторым шагом — только если верхняя запись наша. Скрытие идёт первым, чтобы
 * два быстрых `Esc` не сделали два `history.back()` (второй увёл бы со
 * страницы). `popstate` после `back()` ничего не делает: маркер уже сброшен.
 */
function closeDrawer(returnFocus = true, viaHistory = true): void {
  if (!document.body.classList.contains("nav-open")) return;
  const token = drawerLayerToken;
  hideDrawer(returnFocus);
  // Записи нет (рассинхрон) — `back()` не зовём: он выкинул бы со страницы.
  if (viaHistory && token && currentLayerToken() === token) window.history.back();
}

function initDrawer(): void {
  const trigger = drawerTrigger();
  if (trigger) trigger.setAttribute("aria-expanded", String(document.body.classList.contains("nav-open")));

  for (const button of $$("[data-nav-open]")) {
    button.addEventListener("click", () => openDrawer());
  }
  for (const button of $$("[data-nav-close]")) {
    button.addEventListener("click", () => closeDrawer());
  }
  // Ссылка внутри меню: сначала навигация, потом закрытие — фокус не отбираем,
  // историю не трогаем: `back()` отменил бы переход.
  $("nav#site-nav")?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a[href]")) closeDrawer(false, false);
  });
}

/* ── 3. Фильтры: трек и избранное ──────────────────────────────────── */

let activeTrack: string | null = null;
/** Второй фильтр — по избранному; независим от трека, условия складываются по «И». */
let favoritesOnly = false;

/** Режим списка переключается CSS, но видимость разделителей зависит от него же. */
const mobileList = window.matchMedia(MOBILE_QUERY);

function trackChips(): HTMLButtonElement[] {
  return $$<HTMLButtonElement>("[data-track-chips] > button.track-chip[data-track]");
}

/** id доклада из ячейки: связь «ячейка ↔ избранное» без второго источника правды. */
function cellTalkId(cell: HTMLElement): number {
  const card = cell.querySelector<HTMLElement>("article.talk-card[data-talk-id]");
  return Number(card?.dataset.talkId);
}

function writeTrackToUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (activeTrack) url.searchParams.set("track", activeTrack);
    else url.searchParams.delete("track");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    // `history.state` переносим как есть: в нём может лежать маркер открытого
    // слоя (модалка/drawer), и `null` потерял бы связь записи с ним.
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  } catch {
    // нет History API (file://, песочница) — фильтр продолжает работать без URL
  }
}

function applyFilter(): void {
  const cells = $$<HTMLElement>("div.program-grid__talk-cell[data-track]");
  // День без докладов: ячеек нет, и пустое состояние уже нарисовал Astro.
  if (!cells.length) return;

  let visible = 0;
  for (const cell of cells) {
    const trackMatches = activeTrack === null || cell.dataset.track === activeTrack;
    const favoriteMatches = !favoritesOnly || favorites.has(cellTalkId(cell));
    const show = trackMatches && favoriteMatches;
    // `hidden` на ячейке, а не удаление карточки: сетка не пересобирается и
    // пустые ячейки без `data-track` продолжают держать геометрию.
    cell.hidden = !show;
    if (show) visible += 1;
  }

  const count = $("[data-talk-count]");
  if (count) count.textContent = String(visible);
  const label = $("[data-talk-count-label]");
  if (label) label.textContent = pluralTalks(visible, LANG);
  const empty = $<HTMLElement>("[data-empty]");
  if (empty) {
    empty.hidden = visible !== 0;
    empty.textContent = t(LANG, favoritesOnly ? "emptyFavorites" : "emptyTrack");
  }
  // Карточка могла быть скрыта при первичном замере: теперь у неё есть бокс,
  // и решение «нужна ли кнопка» можно принять честно.
  syncExpandAffordance();

  syncTimeGroups();
}

/**
 * Разделитель времени скрывается только в режиме списка: там он заголовок
 * группы, и группа без видимых докладов оставляет липкий ярлык без содержимого.
 * В сетке он держит колонку времени, поэтому не скрывается никогда.
 */
function syncTimeGroups(): void {
  const content = $<HTMLElement>("div.program-grid__content");
  if (!content) return;

  const listMode = mobileList.matches;
  let current: HTMLElement | null = null;
  let groupHasVisibleTalk = false;

  const closeGroup = (): void => {
    if (current) current.hidden = listMode && !groupHasVisibleTalk;
  };

  for (const node of Array.from(content.children)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList.contains("program-grid__time-cell")) {
      // Ячейка идёт в DOM перед докладами своей строки — группу закрываем на
      // следующем разделителе, а не собираем заранее.
      closeGroup();
      current = node;
      groupHasVisibleTalk = false;
      continue;
    }
    // Пустые ячейки без `data-track` доклада не несут — группа от них не «живая».
    if (
      node.classList.contains("program-grid__talk-cell") &&
      node.dataset.track !== undefined &&
      !node.hidden
    ) {
      groupHasVisibleTalk = true;
    }
  }
  closeGroup();
}

/**
 * `?track=` переезжает вместе с днём: вкладки дней — обычные ссылки, и без
 * правки их `href` фильтр терялся бы на первом же переходе. `dayHref` в ядре
 * не трогаем (это core) — квери добавляется здесь, на клиенте.
 */
function syncDayTabTracks(): void {
  // Drawer — второй путь к дням, особенно на мобиле; без него фильтр терялся
  // на первом же переходе по меню. Внешние ссылки портфолио в drawer'е не
  // трогаем: у них другой origin.
  const links = $$<HTMLAnchorElement>(
    "nav.day-tabs a.day-tab[href], nav#site-nav a.drawer-link[href]",
  );
  for (const link of links) {
    if (
      link.classList.contains("drawer-link") &&
      new URL(link.href).origin !== window.location.origin
    ) {
      continue;
    }
    const href = link.getAttribute("href");
    if (!href) continue;
    try {
      const url = new URL(href, window.location.href);
      if (activeTrack) url.searchParams.set("track", activeTrack);
      else url.searchParams.delete("track");
      link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // некорректный href — оставляем как есть, вкладка продолжает работать
    }
  }
}

/**
 * Один и тот же `activeTrack` читают два вида управления: чипы (десктоп) и
 * нативный список (телефон, см. `.track-select`). Чипы переключает цикл выше,
 * список — здесь: значение и подпись видимой обёртки.
 */
function syncTrackSelect(): void {
  const select = $<HTMLSelectElement>("[data-track-select]");
  const value = $<HTMLElement>("[data-track-select-value]");
  if (!select) return;
  select.value = activeTrack ?? "";
  if (value) {
    const option = select.selectedOptions[0] ?? select.options[select.selectedIndex];
    value.textContent = (option?.textContent ?? t(LANG, "allTracks")).trim();
  }
}

function setActiveTrack(track: string | null, updateUrl = true): void {
  const chips = trackChips();
  const known = track !== null && chips.some((chip) => chip.dataset.track === track) ? track : null;
  activeTrack = known;

  for (const chip of chips) {
    const pressed = known !== null && chip.dataset.track === known;
    chip.setAttribute("aria-pressed", String(pressed));
    chip.classList.toggle("track-chip--active", pressed);
  }
  syncTrackSelect();

  applyFilter();
  syncDayTabTracks();
  if (updateUrl) writeTrackToUrl();
}

function initFilter(): void {
  const chips = trackChips();
  if (!chips.length) return;

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const track = chip.dataset.track ?? "";
      setActiveTrack(activeTrack === track ? null : track);
    });
  }

  // Телефонный список открывает системный пикер; `change` приходит и без
  // выбора (отмена) — тогда значение равно прежнему и фильтр не меняется.
  const select = $<HTMLSelectElement>("[data-track-select]");
  select?.addEventListener("change", () => {
    setActiveTrack(select.value || null);
  });
  syncTrackSelect();

  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get("track");
  } catch {
    raw = null;
  }
  if (!raw) {
    // Ничего не применено — счётчик дня уже отрендерен, сетка целая.
    return;
  }

  const exact = chips.find((chip) => chip.dataset.track === raw);
  const loose = chips.find((chip) => (chip.dataset.track ?? "").toLowerCase() === raw.toLowerCase());
  const chip = exact ?? loose;
  // Резолв по чипам, а не через `resolveTrack` из ядра: та функция читает
  // статический `PROGRAM` и втянула бы в клиентский бандл весь слепок (280 КБ)
  // ради одного сравнения. Плата: `?track=28` (по id) здесь не резолвится —
  // ссылки с чипов всегда несут имя трека.
  // Неизвестный трек в URL не применяем: чип не подсветить, фильтр врал бы.
  if (chip) setActiveTrack(chip.dataset.track ?? null, false);
}

function setFavoritesOnly(next: boolean): void {
  favoritesOnly = next;
  const chip = $<HTMLButtonElement>("button[data-fav-filter]");
  if (chip) {
    chip.setAttribute("aria-pressed", String(next));
    chip.classList.toggle("track-chip--active", next);
  }
  // Панель дублирует состояние того же фильтра: открыв меню, видно, что
  // избранное уже включено, а не только сколько докладов отмечено.
  const drawerButton = $<HTMLButtonElement>("button[data-fav-drawer]");
  if (drawerButton) drawerButton.setAttribute("aria-pressed", String(next));
  // Выбор экрана, а не данные: sessionStorage переживает перезагрузку и не
  // тащит фильтр в новую вкладку, в отличие от localStorage.
  writeStorage(FAV_FILTER_KEY, next ? "1" : "0", "session");
  applyFilter();
}

function initFavFilter(): void {
  const chip = $<HTMLButtonElement>("button[data-fav-filter]");
  if (!chip) return;
  // Состояние читаем до первого применения, иначе чип стартовал бы выключенным
  // и перезагрузка сбрасывала бы выбор.
  favoritesOnly = readStorage(FAV_FILTER_KEY, "session") === "1";
  chip.addEventListener("click", () => setFavoritesOnly(!favoritesOnly));
  // В URL избранное не живёт, но трек из `?track=` уже мог примениться —
  // прогон выравнивает состояние и счётчик с разметкой.
  setFavoritesOnly(favoritesOnly);
}

/* «Избранное» в панели: тот же фильтр, что у чипа, но одним тапом и сразу с
   закрытием меню — иначе после нажатия пользователь остаётся смотреть на
   полупрозрачную панель вместо списка. Фокус на тумблер не возвращаем:
   следующий Tab должен попасть в отфильтрованный список, а не в шапку. */
function initDrawerFavorites(): void {
  const button = $<HTMLButtonElement>("button[data-fav-drawer]");
  if (!button) return;
  button.addEventListener("click", () => {
    closeDrawer(false);
    setFavoritesOnly(true);
    // Без прокрутки фильтр выглядит как «ничего не произошло»: список живёт
    // ниже шапки, вкладок дня и тулбара, а панель открывается с любого места.
    const grid = $(".program-grid");
    if (!grid) return;
    const nav = $("header.nav-mobile");
    const offset = (nav?.getBoundingClientRect().height ?? 0) + 8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: grid.getBoundingClientRect().top + window.scrollY - offset,
      behavior: reduce ? "auto" : "smooth",
    });
  });
}

function initTimeGroups(): void {
  syncTimeGroups();
  // Ширина меняется (ресайз, поворот): без слушателя разделители остались бы
  // скрытыми после возврата в сетку и наоборот — до следующего клика по чипу.
  mobileList.addEventListener("change", () => syncTimeGroups());
}

/* ── 4. Избранное ──────────────────────────────────────────────────── */

const favorites = new Set<number>();

function loadFavorites(): void {
  favorites.clear();
  const raw = readStorage(FAV_KEY);
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // битый JSON — просто пустое избранное
  }
  if (!Array.isArray(parsed)) return;

  for (const value of parsed) {
    const id =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(id)) favorites.add(id);
  }
}

function saveFavorites(): void {
  writeStorage(FAV_KEY, JSON.stringify([...favorites]));
}

/**
 * Чистка осиротевших id. `bun run data:fetch` пересобирает слепок, и часть
 * докладов получает новые id: без чистки бейдж показывал бы избранное, которое
 * нечем открыть (фильтр выводит пустой экран, а снять счётчик неоткуда).
 * Список известных докладов есть только в `/program.json`, поэтому чистка
 * запускается после его загрузки, а не на старте.
 */
function pruneFavorites(talks: Talk[]): void {
  // Перечитываем хранилище: вторая вкладка могла добавить своё, пока ехали данные.
  loadFavorites();
  const known = new Set(talks.map((talk) => talk.id));
  // Плюс всё, что отрендерено на этой странице: если `/program.json` пришёл из
  // старого кеша, его id не должны удалять избранное, которое видно на экране.
  for (const button of $$<HTMLButtonElement>("button[data-fav][data-talk-id]")) {
    const id = Number(button.dataset.talkId);
    if (Number.isFinite(id)) known.add(id);
  }
  let changed = false;
  for (const id of [...favorites]) {
    if (known.has(id)) continue;
    favorites.delete(id);
    changed = true;
  }
  if (!changed) return;
  saveFavorites();
  syncFavorites();
}

function syncModalFav(): void {
  const button = $<HTMLButtonElement>("button[data-modal-fav]");
  if (!button) return;
  const active = modalTalk !== null && favorites.has(modalTalk.id);
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("talk-card__favorite--active", active);
  button.setAttribute("aria-label", t(LANG, active ? "modalFavRemove" : "modalFavAdd"));
  const label = t(LANG, active ? "modalFavActive" : "modalFavAdd");
  const slot = button.querySelector<HTMLElement>("[data-modal-fav-label]");
  if (slot) slot.textContent = label;
  else if (!button.childElementCount) button.textContent = label;
}

function syncFavorites(): void {
  for (const button of $$<HTMLButtonElement>("button[data-fav][data-talk-id]")) {
    const id = Number(button.dataset.talkId);
    const active = Number.isFinite(id) && favorites.has(id);
    button.classList.toggle("talk-card__favorite--active", active);
    button.setAttribute("aria-pressed", String(active));
    // 39 одинаковых «В избранное» неразличимы в списке кнопок скринридера,
    // поэтому к имени добавляется название доклада из этой же карточки.
    const title = button
      .closest(".talk-card")
      ?.querySelector(".talk-card__title-btn")
      ?.textContent?.trim();
    const verb = t(LANG, active ? "modalFavRemove" : "modalFavAdd");
    button.setAttribute(
      "aria-label",
      title ? t(LANG, active ? "cardFavRemove" : "cardFavAdd", { title }) : verb,
    );
    button.title = verb;
  }

  const counter = $("[data-favorites-count]");
  if (counter) counter.textContent = String(favorites.size);
  // Второй счётчик — в чипе фильтра: то же число, одна точка обновления.
  const chipCounter = $("[data-fav-filter-count]");
  if (chipCounter) chipCounter.textContent = String(favorites.size);

  syncModalFav();

  // Звезда при включённом фильтре меняет состав списка: без пересборки снятая
  // карточка осталась бы на экране до следующего клика по чипу.
  if (favoritesOnly) applyFilter();
}

function toggleFavorite(id: number): void {
  if (!Number.isFinite(id)) return;
  // Перечитываем хранилище перед записью: вторая вкладка могла добавить своё,
  // и `saveFavorites()` ниже затёр бы её набор своим (last-writer-wins).
  loadFavorites();
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  syncFavorites();
}

function initFavorites(): void {
  loadFavorites();
  syncFavorites();

  // Другая вкладка изменила избранное — подхватываем без перезагрузки.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== FAV_KEY) return;
    loadFavorites();
    syncFavorites();
  });

  for (const button of $$<HTMLButtonElement>("button[data-fav][data-talk-id]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(Number(button.dataset.talkId));
    });
  }

  $<HTMLButtonElement>("button[data-modal-fav]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (modalTalk) toggleFavorite(modalTalk.id);
  });
}

/* ── 5. «Подробнее» в карточке ─────────────────────────────────────── */

/**
 * Кламп не виден в `scrollHeight` (там всегда высота клампа), поэтому меряем
 * «до/после»: снимаем кламп на один кадр, сравниваем высоту и возвращаем как
 * было. Возвращает `null`, если у карточки сейчас нет бокса (скрыта фильтром):
 * по нулевой высоте решать нельзя, состояние кнопки в этом случае не трогаем.
 */
function isClamped(paragraph: HTMLElement): boolean | null {
  if (!paragraph.getClientRects().length) return null;
  const inline = paragraph.style;
  const saved = {
    clamp: inline.webkitLineClamp,
    display: inline.display,
    overflow: inline.overflow,
  };
  inline.webkitLineClamp = "unset";
  inline.display = "block";
  inline.overflow = "visible";
  const full = paragraph.getBoundingClientRect().height;
  inline.webkitLineClamp = saved.clamp;
  inline.display = saved.display;
  inline.overflow = saved.overflow;
  const clamped = paragraph.getBoundingClientRect().height;
  return full > clamped + 1;
}

/**
 * На билде `canExpand` считает символы, а кламп — строки: 150 знаков дают
 * 5+ строк на 320px и 4 строки на десктопной карточке 391px. Поэтому кнопка
 * есть с запасом у всех «длинных», а здесь прячется та, что ничего не
 * раскрывает — иначе в десктопной сетке «Подробнее» открывало пустоту.
 */
function syncExpandAffordance(): void {
  for (const button of $$<HTMLButtonElement>("button.talk-card__toggle-btn[data-more]")) {
    const card = button.closest<HTMLElement>("article.talk-card");
    const paragraph = card?.querySelector<HTMLElement>(".talk-card__theses p");
    if (!card || !paragraph) {
      button.hidden = true;
      continue;
    }
    if (card.classList.contains("talk-card--expanded")) {
      button.hidden = false;
      continue;
    }
    const clamped = isClamped(paragraph);
    if (clamped !== null) button.hidden = !clamped;
  }
}

function initExpand(): void {
  for (const button of $$<HTMLButtonElement>("button.talk-card__toggle-btn[data-more]")) {
    button.addEventListener("click", (event) => {
      // Кнопка живёт внутри карточки: клик не должен открыть модалку.
      event.stopPropagation();
      event.preventDefault();
      const card = button.closest<HTMLElement>("article.talk-card");
      if (!card) return;
      const expanded = card.classList.toggle("talk-card--expanded");
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = t(LANG, expanded ? "less" : "more");
    });
  }

  syncExpandAffordance();
  // Порог «5 строк» зависит от ширины: 320 → 254px текста, 1440 → 349px.
  // После поворота экрана кнопка должна появиться/исчезнуть сама.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(syncExpandAffordance, 200);
  });
}

/* ── Данные: ленивый мемоизированный fetch ─────────────────────────── */

let programPromise: Promise<Program> | null = null;

function loadProgram(): Promise<Program> {
  if (!programPromise) {
    // `BASE_URL` из ядра: `/` на корне, `/repo/` при `base` в конфиге. Абсолютный
    // `/program.json` ломался бы на project-странице GitHub Pages. Язык — свой
    // префикс: `/en/program.json` уже переведён на билде.
    const dataUrl = `${BASE_URL}${LANG === "en" ? "en/" : ""}program.json`;
    programPromise = fetch(dataUrl, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`program.json: HTTP ${response.status}`);
        return response.json() as Promise<Program>;
      })
      .then((data) => {
        if (!data || !Array.isArray(data.days) || !Array.isArray(data.talks)) {
          throw new Error("program.json: неожиданная форма данных");
        }
        // Здесь впервые известен полный список докладов: только теперь можно
        // отличить «избранное с другого дня» от id, которого больше нет.
        pruneFavorites(data.talks);
        return data;
      })
      .catch((error: unknown) => {
        // Сбрасываем промис, чтобы повторный клик попробовал снова, и
        // отдаём ошибку наверх: показывать её будет тост, не консоль.
        programPromise = null;
        throw error;
      });
  }
  return programPromise;
}

/* ── 5a. Прогрев данных и предзагрузка постера ─────────────────────── */

/**
 * `/program.json` — 280 КБ (63 КБ gzip). Качать его при загрузке страницы
 * нельзя, но и ждать клика до конца нельзя: после первого взаимодействия
 * запрос уходит в простой, и к моменту открытия модалки данные уже едут.
 */
function initWarmup(): void {
  let scheduled = false;

  const warm = (): void => {
    if (scheduled) return;
    scheduled = true;
    const start = (): void => {
      // Ошибку глотаем молча: тост покажет повторная попытка из модалки.
      void loadProgram().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start);
    } else {
      window.setTimeout(start, 200);
    }
  };

  // `once` на каждое событие: прогрев нужен ровно один раз.
  document.addEventListener("pointerdown", warm, { once: true, passive: true });
  document.addEventListener("keydown", warm, { once: true });
}

/**
 * Постер модалки — тот же URL, что баннер карточки. `pointerdown` срабатывает
 * раньше `click` и раньше запроса данных, поэтому картинка стартует на тап,
 * а не на открытие диалога (или берётся из кеша без второго запроса).
 */
function initPosterPrefetch(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>("button.talk-card__title-btn[data-talk-id]");
      if (!button) return;
      const source = button
        .closest("article.talk-card")
        ?.querySelector<HTMLImageElement>("img.talk-card__banner-img[src]")?.src;
      if (!source) return; // компактная карточка без баннера — грузить нечего
      const poster = new Image();
      poster.referrerPolicy = "no-referrer";
      poster.src = source;
    },
    { passive: true },
  );
}

/* ── 6. Модалка доклада ────────────────────────────────────────────── */

let modalTalk: Talk | null = null;
let modalOpener: HTMLElement | null = null;

const modalRoot = (): HTMLElement | null => $<HTMLElement>("div[data-modal]");
const modalDialog = (): HTMLElement | null => $<HTMLElement>("div[data-modal-dialog]");

function focusable(root: ParentNode): HTMLElement[] {
  return $$<HTMLElement>(FOCUSABLE, root);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "•";
}

function buildSpeaker(lector: Talk["lectors"][number]): HTMLElement {
  const row = document.createElement("div");
  row.className = "talk-modal__speaker";

  const photo = imageUrl(lector.photo) ?? "";
  const fallback = (): HTMLElement => {
    const node = document.createElement("span");
    node.className = "talk-modal__speaker-avatar-fallback";
    node.setAttribute("aria-hidden", "true");
    node.textContent = initials(lector.name);
    return node;
  };

  if (photo) {
    const img = document.createElement("img");
    img.className = "talk-modal__speaker-photo";
    img.src = photo;
    img.alt = lector.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
    row.appendChild(img);
  } else {
    row.appendChild(fallback());
  }

  const info = document.createElement("div");
  info.className = "talk-modal__speaker-info";

  const name = document.createElement("span");
  name.className = "talk-modal__speaker-name";
  name.textContent = lector.name;
  info.appendChild(name);

  if (lector.role.trim()) {
    const role = document.createElement("span");
    role.className = "talk-modal__speaker-desc";
    role.textContent = lector.role;
    info.appendChild(role);
  }

  const socials = (lector.socials ?? [])
    .map((link) => ({ network: link.network, url: safeUrl(link.url) }))
    .filter((link) => link.url !== "");
  if (socials.length > 0) {
    const list = document.createElement("span");
    list.className = "social-links";
    for (const link of socials) {
      const anchor = document.createElement("a");
      // Иконка — CSS-маска по классу сети (`program.css`): узла SVG нет,
      // как и в Astro-разметке карточки.
      anchor.className = `social-link social-link--${link.network}`;
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer nofollow";
      anchor.title = SOCIAL_LABELS[link.network];
      anchor.setAttribute("aria-label", `${SOCIAL_LABELS[link.network]}: ${lector.name}`);

      list.appendChild(anchor);
    }
    info.appendChild(list);
  }

  row.appendChild(info);
  return row;
}

/**
 * Скелетон области постера: пока картинка идёт с чужого CDN, диалог не должен
 * показывать пустое место. Разметка не пересобирается — на существующем
 * `[data-modal-media]` включаются класс и `aria-busy`.
 */
function showPosterSkeleton(media: HTMLElement): void {
  media.hidden = false;
  media.classList.add(SKELETON_CLASS);
  media.setAttribute("aria-busy", "true");
  // Фолбэк, пока `program.css` не описал класс: пустой блок без стилей не виден.
  media.style.setProperty("min-block-size", "clamp(140px, 26dvh, 280px)");
  media.style.setProperty("border-radius", "var(--radius-lg, 12px)");
  media.style.setProperty("background", "var(--background-secondary, rgba(127, 127, 127, 0.18))");
}

function clearPosterSkeleton(media: HTMLElement): void {
  media.classList.remove(SKELETON_CLASS);
  media.removeAttribute("aria-busy");
  media.style.removeProperty("min-block-size");
  media.style.removeProperty("border-radius");
  media.style.removeProperty("background");
}

function fillPoster(talk: Talk): void {
  const media = $<HTMLElement>("[data-modal-media]");
  if (!media) return;
  clearPosterSkeleton(media);
  media.replaceChildren();
  const poster = imageUrl(talk.image);
  if (!poster) {
    // Без баннера блок не должен занимать пустое место в диалоге.
    media.hidden = true;
    return;
  }
  // Скелетон появляется сразу, до ответа CDN: диалог уже виден, картинки ещё нет.
  showPosterSkeleton(media);
  const img = document.createElement("img");
  img.className = "talk-modal__poster-img";
  img.src = poster;
  img.alt = talk.title;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  // Обработчики привязаны к конкретной картинке: при быстром переключении
  // докладов поздний `error` уже отсоединённого `img` стирал бы постер
  // следующего, потому что `media` — общий узел.
  img.addEventListener(
    "load",
    () => {
      if (img.isConnected) clearPosterSkeleton(media);
    },
    { once: true },
  );
  // CDN первоисточника отдаёт 403/404: пустая рамка лучше «тёмной дыры».
  img.addEventListener(
    "error",
    () => {
      if (!img.isConnected) return;
      clearPosterSkeleton(media);
      media.replaceChildren();
      media.hidden = true;
    },
    { once: true },
  );
  media.appendChild(img);
  // Картинка уже в памяти: событие `load` до слушателя не дойдёт, и скелетон
  // остался бы висеть под ней.
  if (img.complete) clearPosterSkeleton(media);
}

function fillMeta(talk: Talk): void {
  const meta = $<HTMLElement>("[data-modal-meta]");
  if (!meta) return;
  meta.replaceChildren();

  const parts: Array<[string, string]> = [
    ["talk-modal__track-chip", talk.track || t(LANG, "noTrack")],
    ["talk-modal__time-badge", formatRange(talk)],
    ["talk-modal__hall-badge", talk.hall],
  ];
  // Пилюли разделяет `gap` контейнера, а не текстовый узел «·»: в `flex-wrap`
  // разделитель становится отдельным элементом и переносится один, оставляя
  // висячую точку в конце строки (видно на 390px после бейджа времени).
  for (const [className, text] of parts) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    meta.appendChild(span);
  }
}

function fillSpeakers(talk: Talk): void {
  const speakers = $<HTMLElement>("[data-modal-speakers]");
  if (!speakers) return;
  speakers.replaceChildren();
  for (const lector of talk.lectors) {
    if (lector.name.trim()) speakers.appendChild(buildSpeaker(lector));
  }
}

function fillText(talk: Talk): void {
  const text = $<HTMLElement>("[data-modal-text]");
  if (!text) return;
  text.replaceChildren();

  const raw = String(talk.description || talk.short || "").replace(/\r\n/g, "\n").trim();
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of paragraphs.length ? paragraphs : [t(LANG, "noDescription")]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = part;
    text.appendChild(paragraph);
  }
}

function fillModal(talk: Talk): void {
  const title = $("[data-modal-title]");
  if (title) title.textContent = talk.title;
  fillPoster(talk);
  fillMeta(talk);
  fillSpeakers(talk);
  fillText(talk);
  syncModalFav();
}

function isModalOpen(): boolean {
  const modal = modalRoot();
  return !!modal && !modal.hidden;
}

function showModal(talk: Talk): void {
  const modal = modalRoot();
  const dialog = modalDialog();
  if (!modal || !dialog) return;

  modalTalk = talk;
  fillModal(talk);
  // Запись в истории: системная «Назад» закрывает модалку, а не уводит со
  // страницы. `pushLayer` возвращает `""`, если History API недоступен —
  // тогда закрытие пойдёт напрямую.
  if (!modalLayerToken) modalLayerToken = pushLayer("modal");
  modal.hidden = false;
  document.body.classList.add("is-modal-open");

  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  dialog.scrollTop = 0;
  dialog.focus();
}

/**
 * Номер последнего запроса «открой доклад». Пока `/program.json` едет, `Esc` и
 * системная «Назад» уже закрывают модалку — но `hideModal` выходит рано, когда
 * её ещё нет, и промис открыл бы диалог сам через секунду. Счётчик отменяет
 * устаревший ответ.
 */
let openRequestSeq = 0;

/** Последний рубеж для фокуса: `main` помечен `tabindex="-1"` и фокусируем. */
function focusMain(): void {
  const main = document.getElementById("main");
  if (main instanceof HTMLElement) main.focus();
}

/** Скрытие без истории — единственная точка, где модалка реально исчезает. */
function hideModal(): void {
  openRequestSeq += 1;
  const modal = modalRoot();
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("is-modal-open");
  modalTalk = null;
  modalLayerToken = "";
  const media = $<HTMLElement>("[data-modal-media]");
  if (media) clearPosterSkeleton(media);
  // Возврат фокуса на кнопку, которая открыла диалог: иначе клавиатурный
  // пользователь оказывается в начале документа.
  const opener = modalOpener;
  modalOpener = null;
  if (!opener || !opener.isConnected) {
    focusMain();
    return;
  }
  opener.focus();
  // Фон снимается из `inert` наблюдателем в `TalkModal.astro` уже после нас
  // (системная «Назад» не проходит через его синхронные обработчики): если
  // фокус не встал в инертном поддереве, повторяем следующим микрошагом.
  if (document.activeElement !== opener) {
    queueMicrotask(() => {
      if (opener.isConnected) opener.focus();
      // Кнопку мог скрыть фильтр «Избранное» (звезду сняли внутри модалки):
      // фокус тогда уходит в `main`, а не в начало документа.
      if (document.activeElement !== opener) focusMain();
    });
  }
}

/**
 * Пользовательское закрытие (крестик, фон, `Esc`): модалка скрывается сразу,
 * история отматывается вторым шагом и только если верхняя запись наша —
 * поэтому закрытие и системная «Назад» не срабатывают дважды. Если записи
 * нет — `back()` не зовём: он выкинул бы со страницы.
 */
function closeModal(): void {
  // `Esc` во время загрузки данных: модалки ещё нет, но запрос уже в полёте.
  openRequestSeq += 1;
  if (!isModalOpen()) return;
  const token = modalLayerToken;
  hideModal();
  if (token && currentLayerToken() === token) window.history.back();
}

/** Видимый отклик на тап: кнопка-источник занята, пока едут данные. */
function setBusy(button: HTMLElement | null, busy: boolean): void {
  if (!button) return;
  button.classList.toggle("is-busy", busy);
  if (busy) {
    button.setAttribute("aria-busy", "true");
    // Фолбэк, пока в `program.css` нет правила: `aria-busy` сам по себе не виден.
    button.style.setProperty("opacity", "0.6");
  } else {
    button.removeAttribute("aria-busy");
    button.style.removeProperty("opacity");
  }
}

/** `opener` пуст у deep-link: доклад может быть с другого дня. */
function openTalk(talkId: number, opener: HTMLElement | null): void {
  if (!modalRoot() || !modalDialog()) return;
  modalOpener = opener;
  // Отклик в первую секунду: `/program.json` может ещё ехать, но тап уже
  // виден — кнопка помечена занятой и вернёт вид после ответа.
  setBusy(opener, true);
  const seq = ++openRequestSeq;
  loadProgram()
    .then((program) => {
      // Пока ехали данные, слой закрыли или открыли другой доклад.
      if (seq !== openRequestSeq) return;
      const talk = program.talks.find((item) => item.id === talkId);
      if (!talk) {
        modalOpener = null;
        toast(t(LANG, "toastTalkNotFound"));
        return;
      }
      showModal(talk);
    })
    .catch(() => {
      if (seq !== openRequestSeq) return;
      modalOpener = null;
      toast(t(LANG, "toastLoadFailed"));
    })
    // Снимает занятость только актуальный запрос: устаревший `finally` погасил
    // бы `is-busy` у кнопки, по которой уже идёт новый клик.
    .finally(() => {
      if (seq === openRequestSeq) setBusy(opener, false);
    });
}

/** Общий трап Tab: модалка доклада и диалог поиска держат фокус внутри. */
function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const dialog = root;

  const items = focusable(dialog);
  if (!items.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;

  if (!(active instanceof Node) || !dialog.contains(active) || active === dialog) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function initModal(): void {
  const modal = modalRoot();
  const dialog = modalDialog();
  if (!modal || !dialog) return;

  for (const button of $$<HTMLButtonElement>("button.talk-card__title-btn[data-talk-id]")) {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.talkId);
      if (Number.isFinite(id)) openTalk(id, button);
    });
  }

  for (const button of $$("[data-modal-close]")) {
    button.addEventListener("click", () => closeModal());
  }
  for (const backdrop of $$("[data-modal-backdrop]")) {
    backdrop.addEventListener("click", () => closeModal());
  }
  dialog.addEventListener("keydown", (event) => trapTab(event, modalDialog()));
}

/* ── 7. Экспорт .ics ───────────────────────────────────────────────── */

function visibleTalkIds(): Set<number> {
  const ids = new Set<number>();
  for (const cell of $$<HTMLElement>("div.program-grid__talk-cell[data-track]")) {
    if (cell.hidden) continue;
    const card = cell.querySelector<HTMLElement>("article.talk-card[data-talk-id]");
    const id = Number(card?.dataset.talkId);
    if (Number.isFinite(id)) ids.add(id);
  }
  return ids;
}

function currentDay(program: Program): Day | undefined {
  const root = document.documentElement;
  const id = root.dataset.dayId ?? "";
  const date = root.dataset.dayDate ?? "";
  return (
    program.days.find((day) => String(day.id) === id) ??
    program.days.find((day) => day.date === date)
  );
}

function exportIcs(): void {
  loadProgram()
    .then((program) => {
      const day = currentDay(program);
      // Только видимые доклады: фильтр по треку — это и есть выбор на экспорт.
      const ids = visibleTalkIds();
      const talks = program.talks.filter(
        (talk) => ids.has(talk.id) && isTime(talk.start) && isTime(talk.end),
      );
      if (!day || !DATE_RE.test(day.date) || !talks.length) {
        toast(t(LANG, "toastNoExport"));
        return;
      }
      downloadIcs(calendarFilename(day), buildCalendar(day, talks, new Date(), t(LANG, "brandEvent")));
      toast(
        t(LANG, "toastExported", {
          count: `${talks.length} ${pluralTalks(talks.length, LANG)}`,
        }),
      );
    })
    .catch(() => toast(t(LANG, "toastLoadFailed")));
}

function initExport(): void {
  $<HTMLButtonElement>("button[data-export-ics]")?.addEventListener("click", () => exportIcs());
}

/* ── 7a. Поиск по программе ────────────────────────────────────────── */

/** Номер запроса: ответ на устаревший ввод не должен перетереть свежий. */
let searchSeq = 0;

const searchDialog = (): HTMLElement | null => $<HTMLElement>("[data-search-dialog]");
const searchPanel = (): HTMLElement | null => $<HTMLElement>("[data-search-panel]");
const searchResults = (): HTMLElement | null => $<HTMLElement>("[data-search-results]");
const searchTrigger = (): HTMLButtonElement | null =>
  $<HTMLButtonElement>("button[data-search-open]");

function isSearchOpen(): boolean {
  const dialog = searchDialog();
  return !!dialog && !dialog.hidden;
}

function openSearch(): void {
  const dialog = searchDialog();
  if (!dialog || !dialog.hidden) return;

  searchTrigger()?.setAttribute("aria-expanded", "true");
  // Та же запись истории, что у модалки и drawer'а: системная «Назад»
  // закрывает поиск, а не уводит со страницы.
  if (!searchLayerToken) searchLayerToken = pushLayer("search");

  dialog.hidden = false;
  // Свой класс, а не `is-modal-open`: тот включает inert-менеджер из
  // `TalkModal.astro`, и поле поиска оказалось бы внутри инертного `main`.
  document.body.classList.add("is-search-open");
  // Поэтому фон инертится здесь, вручную: `aria-modal` без `inert` оставляет
  // весь документ доступным для виртуального курсора скринридера.
  inertBackground(dialog);
  $<HTMLInputElement>("[data-search-input]")?.focus();
}

/** Скрытие без истории — единственная точка, где диалог реально исчезает. */
function hideSearch(returnFocus = true): void {
  const dialog = searchDialog();
  if (!dialog || dialog.hidden) return;

  dialog.hidden = true;
  searchLayerToken = "";
  document.body.classList.remove("is-search-open");
  releaseInert();
  // Живая область не должна переживать закрытие: иначе тот же запрос при
  // следующем открытии не изменит текст и не будет объявлен.
  announceSearch(null);

  const trigger = searchTrigger();
  trigger?.setAttribute("aria-expanded", "false");
  if (returnFocus && trigger?.isConnected) trigger.focus();
}

function closeSearch(viaHistory = true): void {
  if (!isSearchOpen()) return;
  const token = searchLayerToken;
  hideSearch();
  if (viaHistory && token && currentLayerToken() === token) window.history.back();
}

/**
 * Адрес страницы дня доклада: дни сортируются по `order`, первый живёт на
 * корне локали, остальные — в `day/<ordinal>/`.
 */
function talkHref(program: Program, talk: Talk): string {
  const ordered = [...program.days].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((day) => day.id === talk.dayId);
  const ordinal = index < 0 ? 1 : index + 1;
  return `${dayHrefFor(LANG, ordinal)}?talk=${talk.id}`;
}

/** Пустой ввод — не «все доклады»: подсказка возвращается, список пуст. */
function clearResults(): void {
  searchResults()?.replaceChildren();
  const hint = $<HTMLElement>("[data-search-hint]");
  const empty = $<HTMLElement>("[data-search-empty]");
  if (hint) hint.hidden = false;
  if (empty) empty.hidden = true;
  // Пустая область: старое «12 докладов» не должно пережить очистку ввода.
  announceSearch(null);
}

/** Что сказать в живую область поиска: `null` — очистить, не объявляя. */
function announceSearch(count: number | null): void {
  const status = $<HTMLElement>("[data-search-status]");
  if (!status) return;
  if (count === null) status.textContent = "";
  else status.textContent = count > 0 ? `${count} ${pluralTalks(count, LANG)}` : t(LANG, "searchEmpty");
}

/** Только `createElement`/`textContent`: данные из JSON не идут в `innerHTML`. */
function renderResults(program: Program, query: string): void {
  const list = searchResults();
  if (!list) return;
  list.replaceChildren();

  const hint = $<HTMLElement>("[data-search-hint]");
  const empty = $<HTMLElement>("[data-search-empty]");
  if (hint) hint.hidden = true;

  const found = searchTalks(program, query);
  for (const talk of found) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "search-result";
    link.href = talkHref(program, talk);

    const day = document.createElement("span");
    day.className = "search-result__day";
    day.textContent = program.days.find((entry) => entry.id === talk.dayId)?.name ?? "";

    const title = document.createElement("span");
    title.className = "search-result__title";
    title.textContent = talk.title;

    const meta = document.createElement("span");
    meta.className = "search-result__meta";
    meta.textContent = `${talk.start} · ${talk.hall}`;

    link.append(day, title, meta);
    item.appendChild(link);
    list.appendChild(item);
  }

  if (empty) empty.hidden = found.length !== 0;
  // Живая область: без неё скринридер не узнаёт ни числа результатов,
  // ни «ничего не найдено» — визуальная выдача для него не меняется.
  announceSearch(found.length);
}

function runSearch(query: string): void {
  const seq = ++searchSeq;
  if (!query.trim()) {
    clearResults();
    return;
  }

  loadProgram()
    .then((program) => {
      // Пока ехали данные, пользователь мог набрать другое — рендерим только
      // ответ на последний запрос.
      if (seq !== searchSeq) return;
      renderResults(program, query);
    })
    .catch(() => {
      if (seq !== searchSeq) return;
      // Ошибка данных — существующим тостом, не в консоль.
      toast(t(LANG, "toastLoadFailed"));
    });
}

function initSearch(): void {
  const dialog = searchDialog();
  const panel = searchPanel();
  const form = $<HTMLFormElement>("[data-search-form]");
  const input = $<HTMLInputElement>("[data-search-input]");
  if (!dialog || !panel || !form || !input) return;

  // `id="search-dialog"` ставит `SearchDialog.astro`: `aria-controls` кнопки в
  // шапке должен резолвиться уже в собранном HTML, а не только после гидрации.

  // Триггер — делегирование, как у темы: кнопка живёт в `Nav.astro`.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-search-open]")) return;
    openSearch();
  });

  for (const button of $$("[data-search-close]")) {
    button.addEventListener("click", () => closeSearch());
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(input.value);
  });
  input.addEventListener("input", () => runSearch(input.value));

  panel.addEventListener("keydown", (event) => trapTab(event, panel));
}

/**
 * `?talk=<id>` — ссылка из поиска на другой день: доклад открывается сразу,
 * как если бы пользователь нажал его карточку. `openTalk` сам дожидается
 * `loadProgram()`.
 */
function initDeepLink(): void {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get("talk");
  } catch {
    raw = null;
  }
  // Только цифры: id уходит в CSS-селектор ниже.
  if (!raw || !/^\d+$/.test(raw)) return;

  const id = Number(raw);
  if (!Number.isFinite(id)) return;

  // `?talk=` — одноразовый вход: id уже прочитан, адрес чистим до `pushLayer`,
  // иначе он остался бы в записи истории и после закрытия модалки: reload
  // открывал бы её снова, а «Вперёд» вёл на запись без слоя.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("talk");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* History недоступен — адрес остаётся как есть */
  }

  const opener = $<HTMLButtonElement>(`button.talk-card__title-btn[data-talk-id="${id}"]`);
  openTalk(id, opener);
}

/* ── 8–9. Запуск ───────────────────────────────────────────────────── */

let started = false;

export function init(): void {
  if (started) return;
  started = true;

  initTheme();
  initDrawer();
  initFilter();
  initFavorites();
  initFavFilter();
  initDrawerFavorites();
  initTimeGroups();
  initExpand();
  initModal();
  initSearch();
  initExport();
  initHistory();
  initWarmup();
  initPosterPrefetch();

  // Esc: сначала закрываем верхний слой, потом drawer.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Поиск — верхний слой: Esc закрывает его первым, даже если снизу
    // открыта модалка.
    if (isSearchOpen()) {
      closeSearch();
      return;
    }
    const modal = modalRoot();
    if (modal && !modal.hidden) {
      closeModal();
      return;
    }
    if (document.body.classList.contains("nav-open")) closeDrawer();
  });

  // Deep-link последним: обработчики слоёв уже на месте.
  initDeepLink();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init(), { once: true });
} else {
  init();
}
