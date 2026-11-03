/**
 * Клиентский слой страницы программы — единственный JS, который уезжает в браузер.
 *
 * Разметку, сетку и стили рисует Astro на билде, поэтому здесь нет ни рендера
 * карточек, ни раскладки: только поведение, которому нужен пользователь, —
 * переключатель темы, drawer, фильтр по трекам, избранное, «Подробнее»,
 * модалка доклада и экспорт `.ics`.
 *
 * Данные (`Program`) приходят из prerendered-эндпоинта `/program.json`
 * лениво — только при первом открытии модалки или экспорте календаря. Промис
 * мемоизирован, ошибка показывается тостом; в консоль не пишем ничего.
 */
import { buildCalendar, calendarFilename, downloadIcs } from "../lib/ics";
import {
  BASE_URL,
  formatRange,
  isTime,
  pluralTalks,
  type Day,
  type Program,
  type Talk,
} from "../lib/program";
import { THEMES, THEME_COLORS, nextTheme, type Theme } from "../lib/theme";

/* ── Константы контракта ───────────────────────────────────────────── */

const THEME_KEY = "theme";
const FAV_KEY = "mm-program:favorites";
const TOAST_MS = 2500;

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

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // приватный режим — живём без сохранения
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
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

function initTheme(): void {
  const stored = readStorage(THEME_KEY);
  const rendered = document.documentElement.dataset.theme;
  const theme: Theme = isTheme(stored) ? stored : isTheme(rendered) ? rendered : "dark";
  applyTheme(theme, false);

  $("button[data-theme-toggle]")?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(nextTheme(isTheme(current) ? current : "dark"), true);
  });
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
  trigger?.setAttribute("aria-label", "Закрыть меню");
  // `inert` убирает панель из таб-порядка и дерева доступности — то же, что
  // делает инлайновый фолбэк в `Base.astro` для страниц без этого скрипта.
  nav?.removeAttribute("inert");
  nav?.querySelector<HTMLElement>("a, button")?.focus();
}

function closeDrawer(returnFocus = true): void {
  const wasOpen = document.body.classList.contains("nav-open");
  document.body.classList.remove("nav-open");
  const trigger = drawerTrigger();
  if (!trigger) return;
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Открыть меню");
  $("nav#site-nav")?.setAttribute("inert", "");
  if (wasOpen && returnFocus) trigger.focus();
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
  // Ссылка внутри меню: сначала навигация, потом закрытие — фокус не отбираем.
  $("nav#site-nav")?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a[href]")) closeDrawer(false);
  });
}

/* ── 3. Фильтр по трекам ───────────────────────────────────────────── */

let activeTrack: string | null = null;

function trackChips(): HTMLButtonElement[] {
  return $$<HTMLButtonElement>("[data-track-chips] > button.track-chip[data-track]");
}

function writeTrackToUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (activeTrack) url.searchParams.set("track", activeTrack);
    else url.searchParams.delete("track");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, "", next);
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
    const show = activeTrack === null || cell.dataset.track === activeTrack;
    // `hidden` на ячейке, а не удаление карточки: сетка не пересобирается и
    // пустые ячейки без `data-track` продолжают держать геометрию.
    cell.hidden = !show;
    if (show) visible += 1;
  }

  const count = $("[data-talk-count]");
  if (count) count.textContent = String(visible);
  const label = $("[data-talk-count-label]");
  if (label) label.textContent = pluralTalks(visible);
  const empty = $<HTMLElement>("[data-empty]");
  if (empty) empty.hidden = visible !== 0;
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

  applyFilter();
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

function syncModalFav(): void {
  const button = $<HTMLButtonElement>("button[data-modal-fav]");
  if (!button) return;
  const active = modalTalk !== null && favorites.has(modalTalk.id);
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("talk-card__favorite--active", active);
  button.setAttribute("aria-label", active ? "Убрать из избранного" : "Добавить в избранное");
  const label = active ? "В избранном" : "В избранное";
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
    const verb = active ? "Убрать из избранного" : "В избранное";
    button.setAttribute("aria-label", title ? `${verb}: ${title}` : verb);
    button.title = verb;
    button.querySelector("path")?.setAttribute("fill", active ? "currentColor" : "none");
  }

  const counter = $("[data-favorites-count]");
  if (counter) counter.textContent = String(favorites.size);

  syncModalFav();
}

function toggleFavorite(id: number): void {
  if (!Number.isFinite(id)) return;
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  syncFavorites();
}

function initFavorites(): void {
  loadFavorites();
  syncFavorites();

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
      button.textContent = expanded ? "Свернуть" : "Подробнее";
    });
  }
}

/* ── Данные: ленивый мемоизированный fetch ─────────────────────────── */

let programPromise: Promise<Program> | null = null;

function loadProgram(): Promise<Program> {
  if (!programPromise) {
    // `BASE_URL` из ядра: `/` на корне, `/repo/` при `base` в конфиге. Абсолютный
    // `/program.json` ломался бы на project-странице GitHub Pages.
    programPromise = fetch(`${BASE_URL}program.json`, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`program.json: HTTP ${response.status}`);
        return response.json() as Promise<Program>;
      })
      .then((data) => {
        if (!data || !Array.isArray(data.days) || !Array.isArray(data.talks)) {
          throw new Error("program.json: неожиданная форма данных");
        }
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

  const photo = safeUrl(lector.photo);
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

  row.appendChild(info);
  return row;
}

function fillPoster(talk: Talk): void {
  const media = $<HTMLElement>("[data-modal-media]");
  if (!media) return;
  media.replaceChildren();
  const poster = safeUrl(talk.image);
  if (!poster) {
    // Без баннера блок не должен занимать пустое место в диалоге.
    media.hidden = true;
    return;
  }
  media.hidden = false;
  const img = document.createElement("img");
  img.className = "talk-modal__poster-img";
  img.src = poster;
  img.alt = talk.title;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  // CDN первоисточника отдаёт 403/404: пустая рамка лучше «тёмной дыры».
  img.addEventListener(
    "error",
    () => {
      media.replaceChildren();
      media.hidden = true;
    },
    { once: true },
  );
  media.appendChild(img);
}

function fillMeta(talk: Talk): void {
  const meta = $<HTMLElement>("[data-modal-meta]");
  if (!meta) return;
  meta.replaceChildren();

  const parts: Array<[string, string]> = [
    ["talk-modal__track-chip", talk.track || "Без трека"],
    ["talk-modal__time-badge", formatRange(talk)],
    ["talk-modal__hall-badge", talk.hall],
  ];
  parts.forEach(([className, text], index) => {
    if (index > 0) meta.appendChild(document.createTextNode(" · "));
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    meta.appendChild(span);
  });
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
  for (const part of paragraphs.length ? paragraphs : ["Описание доклада пока не добавлено."]) {
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

function showModal(talk: Talk): void {
  const modal = modalRoot();
  const dialog = modalDialog();
  if (!modal || !dialog) return;

  modalTalk = talk;
  fillModal(talk);
  modal.hidden = false;
  document.body.classList.add("is-modal-open");

  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  dialog.scrollTop = 0;
  dialog.focus();
}

function closeModal(): void {
  const modal = modalRoot();
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("is-modal-open");
  modalTalk = null;
  // Возврат фокуса на кнопку, которая открыла диалог: иначе клавиатурный
  // пользователь оказывается в начале документа.
  const opener = modalOpener;
  modalOpener = null;
  if (opener && opener.isConnected) opener.focus();
}

function openTalk(talkId: number, opener: HTMLElement): void {
  if (!modalRoot() || !modalDialog()) return;
  modalOpener = opener;
  loadProgram()
    .then((program) => {
      const talk = program.talks.find((item) => item.id === talkId);
      if (!talk) {
        modalOpener = null;
        toast("Доклад не найден");
        return;
      }
      showModal(talk);
    })
    .catch(() => {
      modalOpener = null;
      toast("Не удалось загрузить программу");
    });
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const dialog = modalDialog();
  if (!dialog) return;

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
  dialog.addEventListener("keydown", onDialogKeydown);
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
      if (!day || !talks.length) {
        toast("Нет докладов для экспорта");
        return;
      }
      downloadIcs(calendarFilename(day), buildCalendar(day, talks));
      toast(`В календарь: ${talks.length} докладов`);
    })
    .catch(() => toast("Не удалось загрузить программу"));
}

function initExport(): void {
  $<HTMLButtonElement>("button[data-export-ics]")?.addEventListener("click", () => exportIcs());
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
  initExpand();
  initModal();
  initExport();

  // Esc: сначала закрываем верхний слой, потом drawer.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = modalRoot();
    if (modal && !modal.hidden) {
      closeModal();
      return;
    }
    if (document.body.classList.contains("nav-open")) closeDrawer();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init(), { once: true });
} else {
  init();
}
