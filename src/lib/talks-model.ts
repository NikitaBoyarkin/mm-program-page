/**
 * Типы модели графа: атомарная заметка, хаб, ребро, весь граф.
 *
 * Отдельный модуль, потому что эти типы нужны и раскладке, и сборщику, и
 * странице, — а держать их в одном файле с логикой значило бы связать
 * геометрию с данными. Значения здесь только два: имя хаба «Без трека» и
 * функция его ключа.
 */
/* ── Заметки ─────────────────────────────────────────────────────────────────
   Атомарная единица графа. `key` — постоянный идентификатор (тот же, что у
   `article.talk-card[data-talk-id]`), `anchor` — его адрес на странице программы. */

export interface TalkNote {
  id: number;
  key: string;
  title: string;
  hall: string;
  start: string;
  end: string;
  dayId: number;
  /** Русское имя трека — ключ хаба. Пустой трек из слепка уже заменён на
   *  `UNTRACKED` («Без трека»), поэтому пустой строки здесь не бывает. */
  track: string;
  trackId: number | null;
  themes: string[];
  /** Якорь заметки: `#t309`. Живёт на странице дня и на этой странице. */
  anchor: string;
  /** 1-based номер дня: нужен, чтобы собрать адрес доклада без карты дней. */
  dayOrdinal: number;
  /** Ссылка на заметку в расписании. */
  href: string;
  lectors: string[];
}

export interface HubNode {
  key: string;
  kind: "event" | "track" | "theme";
  label: string;
  /** Английская подпись: у тем она есть, у треков приходит overlay'ем. */
  labelEn?: string;
  /** Сколько заметок несёт хаб: число на подписи и вес ребра. */
  count: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "core" | "topic";
  /** Вес: у `track → theme` — сколько докладов несут оба. */
  weight: number;
}

export interface TalksGraph {
  hubs: HubNode[];
  notes: TalkNote[];
  edges: GraphEdge[];
}

export interface BuildOptions {
  /** `dayId → 1-based номер дня`; по умолчанию дни идут в порядке появления. */
  dayOrdinal?: Map<number, number>;
  /** Префикс каталога: `BASE_URL` подставляет страница, а не модуль. */
  hrefOf?: (dayOrdinal: number, id: number) => string;
}

/** Имя хаба для докладов без трека: `track` в слепке пуст у 27 докладов. */
export const UNTRACKED = "Без трека";

/** Хаб трека: русское имя трека как ключ. Пустой трек получает свой хаб, иначе
 *  27 докладов третьего дня висели бы без родителя. */
export function trackHubKey(track: string): string {
  return `track:${track || UNTRACKED}`;
}
