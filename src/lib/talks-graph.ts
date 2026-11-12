/**
 * Граф докладов на принципах Zettelkasten: заметки, хабы, связи.
 *
 * Программа — это 91 атомарная заметка: у каждой постоянный адрес (`t<id>`,
 * он же якорь `#t309` и параметр `?talk=309`), свой узел-хаб (трек), свои темы
 * и свои соседи. Связи не выдуманы ради картинки: ребро `трек ↔ тема` весит
 * столько докладов, сколько их реально несут оба, а «связанные доклады» —
 * это посчитанное пересечение тем, а не соседство в вёрстке.
 *
 * Файл — точка входа модели и реэкспорт её частей: словарь тем
 * (`talks-themes.ts`), типы (`talks-model.ts`), геометрия (`talks-layout.ts`).
 * Разрез сделан по швам, а не по размеру: потребителю (`TalksPage`, карточка,
 * тесты) достаточно импортировать `talks-graph`, и он не обязан знать, из
 * скольких файлов собрана модель.
 */
import type { Talk } from "./program-core";
import {
  UNTRACKED,
  trackHubKey,
  type BuildOptions,
  type GraphEdge,
  type HubNode,
  type TalkNote,
  type TalksGraph,
} from "./talks-model";
import { THEMES, themeLabel, themesOf, type Theme } from "./talks-themes";

export * from "./talks-model";
export * from "./talks-themes";
export * from "./talks-layout";

export function buildNotes(talks: Talk[], options: BuildOptions = {}): TalkNote[] {
  const ordinalOf = options.dayOrdinal ?? ordinalByFirstAppearance(talks);
  const hrefOf = options.hrefOf ?? ((_dayOrdinal: number, id: number) => `#t${id}`);
  const trackIdOf = new Map(talks.map((talk) => [talk.id, talk.trackId ?? null]));

  return talks
    .map((talk) => {
      const dayOrdinal = ordinalOf.get(talk.dayId) ?? 1;
      return {
        id: talk.id,
        key: `t${talk.id}`,
        title: talk.title,
        hall: talk.hall,
        start: talk.start,
        end: talk.end,
        dayId: talk.dayId,
        track: talk.track || UNTRACKED,
        trackId: trackIdOf.get(talk.id) ?? null,
        themes: themesOf(talk),
        anchor: `t${talk.id}`,
        dayOrdinal,
        href: hrefOf(dayOrdinal, talk.id),
        lectors: (talk.lectors ?? []).map((lector) => lector.name),
      } satisfies TalkNote;
    })
    .sort((a, b) => a.dayOrdinal - b.dayOrdinal || a.start.localeCompare(b.start) || a.id - b.id);
}

function ordinalByFirstAppearance(talks: Talk[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const talk of talks) if (!map.has(talk.dayId)) map.set(talk.dayId, map.size + 1);
  return map;
}

/* ── Граф ────────────────────────────────────────────────────────────────────
   Хабы и агрегированные рёбра. Отдельной заметкой в графе доклад не рисуется:
   104 узла в force-раскладке слипаются (это уже проверено в портфолио), а ребро
   «трек ↔ тема» честно показывает, где треки пересекаются по содержанию. */

export function buildGraph(notes: TalkNote[], eventLabel: string): TalksGraph {
  const tracks = new Map<string, HubNode>();
  const themes = new Map<string, HubNode>();
  const pairs = new Map<string, number>();

  for (const note of notes) {
    const trackKey = trackHubKey(note.track);
    const track = tracks.get(trackKey) ?? { key: trackKey, kind: "track", label: note.track, count: 0 };
    track.count += 1;
    tracks.set(trackKey, track);

    for (const themeId of note.themes) {
      const themeKey = `theme:${themeId}`;
      const theme = themes.get(themeKey) ?? {
        key: themeKey,
        kind: "theme",
        label: themeLabel(themeId, "ru"),
        labelEn: themeLabel(themeId, "en"),
        count: 0,
      };
      theme.count += 1;
      themes.set(themeKey, theme);

      const pairKey = `${trackKey}|${themeKey}`;
      pairs.set(pairKey, (pairs.get(pairKey) ?? 0) + 1);
    }
  }

  const event: HubNode = { key: "event", kind: "event", label: eventLabel, count: notes.length };
  const hubList = [
    event,
    ...[...tracks.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru")),
    ...[...themes.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru")),
  ];

  const edges: GraphEdge[] = [
    ...[...tracks.values()].map((track) => ({
      from: event.key,
      to: track.key,
      kind: "core" as const,
      weight: track.count,
    })),
    ...[...pairs.entries()].map(([pairKey, weight]) => {
      const [from, to] = pairKey.split("|") as [string, string];
      return { from, to, kind: "topic" as const, weight };
    }),
  ];

  return { hubs: hubList, notes, edges };
}

/* ── Связи между заметками ───────────────────────────────────────────────────
   Веса взяты у рабочей реализации в портфолио: тема (IDF-косинус) важнее
   трека, трек важнее соседства в зале, день — только тай-брейк. Спикеров здесь
   нет намеренно: в слепке 94 имени и ни одно не повторяется, ребро по спикеру
   не соединило бы ничего. */

const RELATED_K = 4;
const RELATED_THRESHOLD = 2;
const RELATED_MIN = 1;

export interface RelatedNote {
  id: number;
  anchor: string;
  /** Постоянный адрес заметки в расписании (`/day/2/#t309`) — тот же, что на
   *  странице графа: ссылка «Связанные» ведёт к заметке, а не в пустоту. */
  href: string;
  title: string;
  track: string;
  score: number;
  sharedThemes: string[];
  sameTrack: boolean;
  adjacent: boolean;
}

export function relatedNotes(notes: TalkNote[], k = RELATED_K): Map<number, RelatedNote[]> {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const frequency = new Map<string, number>();
  for (const note of notes) for (const theme of note.themes) frequency.set(theme, (frequency.get(theme) ?? 0) + 1);
  const total = Math.max(1, notes.length);
  const idf = (theme: string) => Math.log(1 + total / (frequency.get(theme) ?? 1));

  /** Соседи в одном зале внутри одного дня: доклад «до» и «после». */
  const adjacency = new Map<number, Set<number>>();
  const runs = new Map<string, TalkNote[]>();
  for (const note of notes) runs.set(`${note.dayId}|${note.hall}`, [...(runs.get(`${note.dayId}|${note.hall}`) ?? []), note]);
  for (const run of runs.values()) {
    const ordered = [...run].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1] as TalkNote;
      const next = ordered[i] as TalkNote;
      adjacency.set(prev.id, new Set([...(adjacency.get(prev.id) ?? []), next.id]));
      adjacency.set(next.id, new Set([...(adjacency.get(next.id) ?? []), prev.id]));
    }
  }

  const score = (a: TalkNote, b: TalkNote): RelatedNote | null => {
    const shared = a.themes.filter((theme) => b.themes.includes(theme));
    // Косинус по IDF-взвешенным темам: редкая тема весит больше частой, иначе
    // «метрики» связали бы половину программы с половиной.
    const dot = shared.reduce((acc, theme) => acc + idf(theme), 0);
    const norm = (themes: string[]) =>
      Math.sqrt(themes.reduce((acc, theme) => acc + idf(theme) * idf(theme), 0));
    const denominator = norm(a.themes) * norm(b.themes);
    // Гейт: одна общая тема — часто совпадение словаря, а не общий предмет.
    // Чем чаще тема в программе, тем меньше весит единственное совпадение.
    const gate =
      shared.length >= 2
        ? 1
        : 1 - (frequency.get(shared[0] ?? "") ?? 1) / total;
    const cosine = denominator > 0 ? (dot / denominator) * gate : 0;

    // «Без трека» — не трек: 27 докладов третьего дня не становятся соседями
    // по треку только потому, что у всех пустое поле.
    const sameTrack = a.track !== UNTRACKED && a.track === b.track;
    const adjacent = adjacency.get(a.id)?.has(b.id) ?? false;
    const sameDay = a.dayId === b.dayId;

    const weight = 4 * cosine + (sameTrack ? 1.6 : 0) + (adjacent ? 0.9 : 0) + (sameDay ? 0.2 : 0);
    if (weight < RELATED_THRESHOLD) return null;
    return { id: b.id, anchor: b.anchor, href: b.href, title: b.title, track: b.track, score: weight, sharedThemes: shared, sameTrack, adjacent };
  };

  const result = new Map<number, RelatedNote[]>();
  for (const note of notes) {
    const scored: RelatedNote[] = [];
    for (const other of notes) {
      if (other.id === note.id) continue;
      const relation = score(note, other);
      if (relation) scored.push(relation);
    }
    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    // Пол у каждой заметки: изолированный узел — не «связь», а дырка в сети.
    // Добираем структурно — свой трек, потом тот же день и зал.
    if (scored.length < RELATED_MIN) {
      const pool = notes.filter((other) => other.id !== note.id);
      const byStart = (a: TalkNote, b: TalkNote) => a.start.localeCompare(b.start) || a.id - b.id;
      // Три ступени, в порядке силы связи: свой трек → тот же зал и день →
      // тот же день. Последняя ступень нужна докладам без тем и без трека:
      // без неё узел остался бы без единой связи.
      const stages: Array<{ pool: TalkNote[]; sameTrack: boolean; adjacent: boolean }> = [
        { pool: pool.filter((other) => note.track !== UNTRACKED && other.track === note.track), sameTrack: true, adjacent: false },
        { pool: pool.filter((other) => other.dayId === note.dayId && other.hall === note.hall), sameTrack: false, adjacent: true },
        { pool: pool.filter((other) => other.dayId === note.dayId), sameTrack: false, adjacent: false },
      ];
      for (const stage of stages) {
        for (const other of [...stage.pool].sort(byStart)) {
          if (scored.length >= RELATED_MIN) break;
          if (scored.some((item) => item.id === other.id)) continue;
          scored.push({ id: other.id, anchor: other.anchor, href: other.href, title: other.title, track: other.track, score: 0, sharedThemes: [], sameTrack: stage.sameTrack, adjacent: stage.adjacent });
        }
        if (scored.length >= RELATED_MIN) break;
      }
    }
    result.set(note.id, scored.slice(0, k));
  }

  // Симметрия: если A ссылается на B, у B появляется обратная ссылка — иначе
  // это не сеть заметок, а односторонний указатель.
  for (const [id, relations] of result) {
    for (const relation of relations) {
      const back = result.get(relation.id);
      if (!back || back.some((item) => item.id === id)) continue;
      const note = byId.get(id);
      if (note) back.push({ id: note.id, anchor: note.anchor, href: note.href, title: note.title, track: note.track, score: relation.score, sharedThemes: relation.sharedThemes, sameTrack: relation.sameTrack, adjacent: relation.adjacent });
    }
  }

  // Обратные ссылки дописываются уже после сортировки прямых, поэтому порядок
  // нормализуется один раз в конце: иначе список выглядел бы упорядоченным
  // только у тех заметок, до которых обход дошёл последними.
  for (const [id, relations] of result) {
    const seen = new Set<number>();
    result.set(
      id,
      relations
        .filter((relation) => (seen.has(relation.id) ? false : seen.add(relation.id)))
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, k),
    );
  }

  return result;
}

/** Заметки, сгруппированные по хабу трека: порядок хаба — порядок в графе. */
export function notesByTrack(graph: TalksGraph): Array<{ hub: HubNode; notes: TalkNote[] }> {
  return graph.hubs
    .filter((hub) => hub.kind === "track")
    .map((hub) => ({
      hub,
      notes: graph.notes.filter((note) => trackHubKey(note.track) === hub.key),
    }));
}

/** Заметки по темам: обратный индекс «тема → на каких докладах она держится».
 *  Это и есть обратные ссылки Zettelkasten: из хаба темы видно все заметки,
 *  которые на него ссылаются, включая чужие треки. */
export function notesByTheme(graph: TalksGraph): Array<{ theme: Theme; notes: TalkNote[] }> {
  return THEMES.map((theme) => ({
    theme,
    notes: graph.notes.filter((note) => note.themes.includes(theme.id)),
  })).filter((group) => group.notes.length > 0);
}
