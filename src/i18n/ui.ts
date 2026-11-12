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
  navFavorites: "Избранное",
  navFavoritesOpen: "Показать избранные доклады",
  navHome: "Главная",
  navProjects: "Проекты",
  navContacts: "Контакты",
  navTalks: "Граф докладов",
  langSwitch: "Switch to English",
  pageTitle: "Программа конференции",
  factsDuration: "Длительность",
  factsTalks: "Доклады",
  factsTracks: "Треки",
  factsHalls: "Залы",
  factsThemes: "Темы",
  factsLinks: "Связи",
  talksTitle: "Граф докладов",
  talksIntro:
    "Расписание — одна проекция программы, граф — вторая. Внутри круга темы, снаружи треки, каждое ребро — доклады, которые несут и трек, и тему. Ниже те же заметки: у каждой постоянный адрес, свои темы и связанные доклады.",
  talksGraphTitle: "Темы и треки",
  talksGraphAria: "Граф связей: темы программы внутри, треки снаружи, доклады на дугах",
  talksGraphCaption:
    "Точка на внешней дуге — один доклад: ссылка ведёт к его заметке. Толщина ребра — сколько докладов несут и трек, и тему; редкая тема весит больше частой.",
  talksNotesTitle: "Заметки по трекам",
  talksNotesIntro:
    "Атомарная единица программы — доклад. Адрес заметки постоянный: #t309 открывает её и в расписании дня, и здесь.",
  talksThemesTitle: "Темы как обратные ссылки",
  talksThemesIntro:
    "Хаб темы собирает доклады из разных треков — это и есть поперечные связи программы, которых не видно в сетке по залам.",
  talksRelated: "Связанные",
  talksNoThemes: "без тем",
  talksDay: "День {n}",
  talksPortfolio: "Полная версия графа — в портфолио",
  talksPortfolioNote: "Там же темы каждой карточки и рекомендации по докладам.",
  talksToProgram: "К расписанию",
  metaTalks:
    "91 доклад, 11 треков и 11 тем Матемаркетинг 2026: граф связей, заметки с постоянными адресами и обратные ссылки.",
  dayTabsLabel: "Дни программы",
  trackFiltersLabel: "Фильтры программы",
  favoritesChip: "Избранное",
  allTracks: "Все треки",
  exportIcs: "Загрузить .ics",
  scheduleTitle: "Расписание докладов",
  timeHeader: "Время",
  introLine: "{day} программы: {n} {talks} в {halls} залах. Время указано по Москве.",
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
  navFavorites: "Favorites",
  navFavoritesOpen: "Show favorite talks",
  navHome: "Home",
  navProjects: "Projects",
  navContacts: "Contacts",
  navTalks: "Talks graph",
  langSwitch: "Переключить на русский",
  pageTitle: "Conference program",
  factsDuration: "Duration",
  factsTalks: "Talks",
  factsTracks: "Tracks",
  factsHalls: "Halls",
  factsThemes: "Themes",
  factsLinks: "Links",
  talksTitle: "Talks graph",
  talksIntro:
    "The schedule is one projection of the program, the graph is the other. Themes sit inside the circle, tracks outside, and every edge is the talks that carry both a track and a theme. Below are the same notes: each with a permanent address, its themes and its related talks.",
  talksGraphTitle: "Themes and tracks",
  talksGraphAria: "Relation graph: program themes inside, tracks outside, talks on the arcs",
  talksGraphCaption:
    "A dot on the outer arc is one talk: the link leads to its note. Edge width is how many talks carry both the track and the theme; a rare theme weighs more than a common one.",
  talksNotesTitle: "Notes by track",
  talksNotesIntro:
    "The atomic unit of the program is one talk. Its address is permanent: #t309 opens the note both in the day schedule and here.",
  talksThemesTitle: "Themes as backlinks",
  talksThemesIntro:
    "A theme hub gathers talks from different tracks — the cross-links of the program that the hall grid never shows.",
  talksRelated: "Related",
  talksNoThemes: "no themes",
  talksDay: "Day {n}",
  talksPortfolio: "Full graph version — in the portfolio",
  talksPortfolioNote: "Every card there also carries its themes and related talks.",
  talksToProgram: "To the schedule",
  metaTalks:
    "91 talks, 11 tracks and 11 themes of Matemarketing 2026: a relation graph, notes with permanent addresses and backlinks.",
  dayTabsLabel: "Program days",
  trackFiltersLabel: "Program filters",
  favoritesChip: "Favorites",
  allTracks: "All tracks",
  exportIcs: "Download .ics",
  scheduleTitle: "Talk schedule",
  timeHeader: "Time",
  introLine: "{day} of the program: {n} {talks} in {halls} halls. Times are Moscow time.",
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
