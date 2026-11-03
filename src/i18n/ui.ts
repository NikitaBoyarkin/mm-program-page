/**
 * Словарь интерфейса: единственный источник строк, которые видит пользователь.
 *
 * Контент докладов (заголовки, описания, роли спикеров) здесь не живёт — он
 * приходит из `src/data/program.en.json` через `src/lib/localize.ts`. Здесь
 * только оболочка: шапка, табы, фильтры, модалка, подвал, поиск.
 *
 * Ключи обязаны совпадать в обоих языках: `UiKey` выводится из русской ветки,
 * поэтому пропуск в `en` — ошибка типов, а не тихая подстановка.
 */

export const LANGS = ["ru", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "ru";

const RU = {
  skipLink: "Перейти к содержимому",
  brandName: "Никита Бояркин",
  brandRole: "Продуктовый аналитик",
  brandEvent: "Матемаркетинг 2026",
  navMenuLabel: "Меню",
  navOpen: "Открыть меню",
  navClose: "Закрыть меню",
  navThemeToggle: "Сменить тему",
  navThemeHint: "Сменить тему: тёмная → светлая → киберпанк",
  navThemeNote: "Три темы: тёмная, светлая, киберпанк. Выбор запоминается в браузере.",
  navFavorites: "Избранное",
  navHome: "Главная",
  navProjects: "Проекты",
  navContacts: "Контакты",
  langSwitch: "Switch to English",
  pageTitle: "Программа конференции",
  factsDuration: "Длительность",
  factsTalks: "Доклады",
  factsTracks: "Треки",
  factsHalls: "Залы",
  dayTabsLabel: "Дни программы",
  trackFiltersLabel: "Фильтры программы",
  favoritesChip: "Избранное",
  allTracks: "Все треки",
  trackSelectLabel: "Фильтр по треку",
  exportIcs: "Загрузить .ics",
  scheduleTitle: "Расписание докладов",
  timeHeader: "Время",
  introLine:
    "{day} программы: {n} {talks} в {halls} залах. Время указано по Москве; сетка повторяет страницу первоисточника, но собрана на билде.",
  emptyTrack: "По этому треку в выбранный день докладов нет.",
  emptyFavorites: "В избранном пока нет докладов этого дня.",
  more: "Подробнее",
  less: "Свернуть",
  modalClose: "Закрыть",
  modalBuy: "Купить билет",
  modalFavAdd: "В избранное",
  modalFavRemove: "Убрать из избранного",
  cardFavAdd: "В избранное: {title}",
  cardFavRemove: "Убрать из избранного: {title}",
  noTrack: "Без трека",
  searchOpen: "Поиск по программе",
  searchTitle: "Поиск по программе",
  searchClose: "Закрыть поиск",
  searchPlaceholder: "Доклад, спикер, трек",
  searchHint: "Ищет по всем трём дням: название, спикер, трек, зал.",
  searchEmpty: "Ничего не найдено.",
  modalFavActive: "В избранном",
  noDescription: "Описание доклада пока не добавлено.",
  toastTalkNotFound: "Доклад не найден",
  toastLoadFailed: "Не удалось загрузить программу",
  toastNoExport: "Нет докладов для экспорта",
  toastExported: "В календарь: {count}",
  footerSource:
    "Учебная копия страницы {link}. Данные и медиа не перепубликуются, а подтягиваются с CDN Матемаркетинга.",
  footerSourceLink: "первоисточника",
  footerTickets: "{link} на конференцию — на сайте организатора.",
  footerTicketsLink: "Билеты",
  footerRights:
    "Права на дизайн, тексты программы, названия докладов и изображения принадлежат Матемаркетингу и спикерам. Это неофициальная учебная копия, не связанная с организаторами.",
  footerNote: "Собрано как разбор интерфейса: вёрстка и логика — учебные.",
  metaDescription:
    "91 доклад и 11 треков за три дня — 26 и 27 ноября плюс онлайн-день. Расписание по залам, поиск по спикеру, избранное и экспорт в календарь.",
} as const;

const EN: Record<keyof typeof RU, string> = {
  skipLink: "Skip to content",
  brandName: "Nikita Boyarkin",
  brandRole: "Product analyst",
  brandEvent: "Matemarketing 2026",
  navMenuLabel: "Menu",
  navOpen: "Open menu",
  navClose: "Close menu",
  navThemeToggle: "Change theme",
  navThemeHint: "Change theme: dark → light → cyberpunk",
  navThemeNote: "Three themes: dark, light, cyberpunk. Your choice is saved in the browser.",
  navFavorites: "Favorites",
  navHome: "Home",
  navProjects: "Projects",
  navContacts: "Contacts",
  langSwitch: "Переключить на русский",
  pageTitle: "Conference program",
  factsDuration: "Duration",
  factsTalks: "Talks",
  factsTracks: "Tracks",
  factsHalls: "Halls",
  dayTabsLabel: "Program days",
  trackFiltersLabel: "Program filters",
  favoritesChip: "Favorites",
  allTracks: "All tracks",
  trackSelectLabel: "Filter by track",
  exportIcs: "Download .ics",
  scheduleTitle: "Talk schedule",
  timeHeader: "Time",
  introLine:
    "{day} of the program: {n} {talks} in {halls} halls. Times are Moscow time; the grid mirrors the original page but is built at build time.",
  emptyTrack: "No talks for this track on this day.",
  emptyFavorites: "No favorites for this day yet.",
  more: "Show more",
  less: "Show less",
  modalClose: "Close",
  modalBuy: "Buy a ticket",
  modalFavAdd: "Add to favorites",
  modalFavRemove: "Remove from favorites",
  cardFavAdd: "Add to favorites: {title}",
  cardFavRemove: "Remove from favorites: {title}",
  noTrack: "No track",
  searchOpen: "Search the program",
  searchTitle: "Search the program",
  searchClose: "Close search",
  searchPlaceholder: "Talk, speaker, track",
  searchHint: "Searches all three days: title, speaker, track, hall.",
  searchEmpty: "Nothing found.",
  modalFavActive: "In favorites",
  noDescription: "No description for this talk yet.",
  toastTalkNotFound: "Talk not found",
  toastLoadFailed: "Couldn't load the program",
  toastNoExport: "No talks to export",
  toastExported: "Added to calendar: {count}",
  footerSource:
    "Study copy of the {link}. Data and media are not republished — they load from the Matemarketing CDN.",
  footerSourceLink: "original page",
  footerTickets: "{link} for the conference — on the organizer's site.",
  footerTicketsLink: "Tickets",
  footerRights:
    "Design, program texts, talk titles and images belong to Matemarketing and the speakers. This is an unofficial study copy, not affiliated with the organizers.",
  footerNote: "Built as an interface study: the layout and logic are for learning.",
  metaDescription:
    "91 talks across 11 tracks in three days — 26 and 27 November plus an online day. Schedule by hall, speaker search, favorites and calendar export.",
};

export const UI: Record<Lang, Record<keyof typeof RU, string>> = { ru: RU, en: EN };

export type UiKey = keyof typeof RU;

/** Подстановка `{name}` в шаблон; неизвестный параметр остаётся видимым. */
export function t(lang: Lang, key: UiKey, params?: Record<string, string | number>): string {
  const template = UI[lang]?.[key] ?? RU[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function otherLang(lang: Lang): Lang {
  return lang === "en" ? "ru" : "en";
}
