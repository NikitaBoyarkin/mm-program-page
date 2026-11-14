/**
 * Раскладка графа: три кольца, без физики.
 *
 * Выделено из `talks-graph.ts`: геометрия не знает, откуда взялись веса, —
 * ей на вход приходит готовый `TalksGraph`. Раскладка детерминирована (никакой
 * случайности), поэтому один слепок даёт побайтово один и тот же SVG и `git
 * diff` не шумит координатами.
 */
import { trackHubKey, type GraphEdge, type HubNode, type TalksGraph, type TalkNote } from "./talks-model";

/* ── Раскладка ───────────────────────────────────────────────────────────────
   Три кольца, без физики: центр — событие, среднее кольцо — темы, внешнее —
   треки. Рёбра `трек ↔ тема` идут хордами, поэтому «где треки пересекаются»
   видно без наведения. Порядок колец фиксирован сортировкой в `buildGraph`,
   значит координаты стабильны между билдами. */

export interface PlacedHub extends HubNode {
  x: number;
  y: number;
  radius: number;
  angle: number;
  ring: 0 | 1 | 2;
  /** Дуга трека на внешнем кольце: заметки делят её между собой. */
  arcStart?: number;
  arcEnd?: number;
}

export interface PlacedNote extends TalkNote {
  x: number;
  y: number;
  angle: number;
  hubKey: string;
}

export interface PlacedEdge extends GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Толщина: вес нормирован по самому тяжёлому ребру. */
  width: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  hubs: PlacedHub[];
  notes: PlacedNote[];
  edges: PlacedEdge[];
}

/** Координата с двумя знаками: без округления в SVG уходили хвосты вида
 *  `552.9865103565057`, и «побайтово» держалось только в пределах одного
 *  движка — JSC и V8 расходятся в последнем ulp. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function layoutGraph(graph: TalksGraph): GraphLayout {
  const width = 960;
  const height = 720;
  const cx = width / 2;
  const cy = height / 2;
  const themeRing = 128;
  const trackRing = 246;
  const noteRing = 296;
  // Зазор между секторами треков. Без него последняя точка трека A стоит от
  // первой точки трека B на те же 20 px, что и соседи внутри трека, и кольцо
  // читается сплошным пунктиром, а не двенадцатью группами.
  const gutter = (2.5 * Math.PI) / 180;

  const themes = graph.hubs.filter((hub) => hub.kind === "theme");
  const tracks = graph.hubs.filter((hub) => hub.kind === "track");
  const placed = new Map<string, PlacedHub>();

  // Радиус — линейная шкала по числу заметок, а не корень: у sqrt-шкалы 7 и 8
  // докладов давали 19.4 и 19.9 px, то есть ранг читался только по краям.
  const themeMax = Math.max(1, ...themes.map((theme) => theme.count));
  const trackMax = Math.max(1, ...tracks.map((track) => track.count));
  const themeRadius = (count: number): number => round2(13 + 13 * (count / themeMax));
  const trackRadius = (count: number): number => round2(14 + 14 * (count / trackMax));

  const eventHub = graph.hubs.find((hub) => hub.kind === "event");
  if (eventHub) {
    // Центр — самый крупный круг: у него весь граф, а не срез. Раньше событие
    // было 20 px при темах до 25.3 — корень читался мельче своих категорий.
    const biggest = Math.max(0, ...[...themes, ...tracks].map((hub) =>
      hub.kind === "theme" ? themeRadius(hub.count) : trackRadius(hub.count),
    ));
    placed.set(eventHub.key, {
      ...eventHub,
      x: cx,
      y: cy,
      radius: round2(biggest + 4),
      angle: -Math.PI / 2,
      ring: 0,
    });
  }

  // Темы — внутреннее кольцо: это общий словарь, на который ссылается каждый
  // трек. Угол равномерный: у тем нет порядка программы, есть только словарь.
  themes.forEach((theme, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, themes.length)) * Math.PI * 2;
    placed.set(theme.key, {
      ...theme,
      x: round2(cx + Math.cos(angle) * themeRing),
      y: round2(cy + Math.sin(angle) * themeRing),
      radius: themeRadius(theme.count),
      angle,
      ring: 1,
    });
  });

  // Треки — внешнее кольцо. Дуга трека пропорциональна числу его заметок, а не
  // равна всем: иначе 27 докладов «Без трека» и 2 кейноута получили бы по
  // одинаковому сектору, и точки слиплись бы в одном месте.
  const total = Math.max(1, graph.notes.length);
  const usable = Math.PI * 2 - gutter * tracks.length;
  const placedNotes: PlacedNote[] = [];
  let cursor = -Math.PI / 2;

  tracks.forEach((track) => {
    const count = Math.max(1, track.count);
    const span = (count / total) * usable;
    const arcStart = cursor;
    const arcEnd = cursor + span;
    const angle = (arcStart + arcEnd) / 2;
    cursor = arcEnd + gutter;

    placed.set(track.key, {
      ...track,
      x: round2(cx + Math.cos(angle) * trackRing),
      y: round2(cy + Math.sin(angle) * trackRing),
      radius: trackRadius(track.count),
      angle,
      ring: 2,
      arcStart,
      arcEnd,
    });

    const own = graph.notes.filter((note) => trackHubKey(note.track) === track.key);
    own.forEach((note, index) => {
      const noteAngle = arcStart + ((index + 0.5) / count) * span;
      placedNotes.push({
        ...note,
        angle: noteAngle,
        hubKey: track.key,
        x: round2(cx + Math.cos(noteAngle) * noteRing),
        y: round2(cy + Math.sin(noteAngle) * noteRing),
      });
    });
  });

  // Шкала считается только по смысловым рёбрам. Вес спицы «событие → трек» —
  // это число докладов трека (до 27), и пока он участвовал в нормировке,
  // пересечения весом 1…7 сжимались в 0.9–1.6 px, а служебная линия рисовалась
  // самой толстой: читатель видел акцент там, где информация отсутствует.
  const topicMax = Math.max(
    1,
    ...graph.edges.filter((edge) => edge.kind === "topic").map((edge) => edge.weight),
  );
  const edges: PlacedEdge[] = graph.edges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return [];
    return [
      {
        ...edge,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        // Толщина в px: 0.8 — связь в один доклад, 3.2 — сильнейшее
        // пересечение. Пол нужен, чтобы слабое ребро не исчезло в рендере.
        // Иерархия толщиной не кодируется: у неё постоянная 1.1, а тип несёт
        // штрих (CSS).
        width: round2(edge.kind === "core" ? 1.1 : 0.8 + 2.4 * (edge.weight / topicMax)),
      },
    ];
  });

  return { width, height, hubs: [...placed.values()], notes: placedNotes, edges };
}
