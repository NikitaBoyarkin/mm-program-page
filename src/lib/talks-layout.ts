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

export function layoutGraph(graph: TalksGraph): GraphLayout {
  const width = 960;
  const height = 720;
  const cx = width / 2;
  const cy = height / 2;
  const themeRing = 128;
  const trackRing = 246;
  const noteRing = 296;

  const themes = graph.hubs.filter((hub) => hub.kind === "theme");
  const tracks = graph.hubs.filter((hub) => hub.kind === "track");
  const placed = new Map<string, PlacedHub>();

  const eventHub = graph.hubs.find((hub) => hub.kind === "event");
  if (eventHub) {
    placed.set(eventHub.key, { ...eventHub, x: cx, y: cy, radius: 20, angle: -Math.PI / 2, ring: 0 });
  }

  // Темы — внутреннее кольцо: это общий словарь, на который ссылается каждый
  // трек. Угол равномерный: у тем нет порядка программы, есть только словарь.
  themes.forEach((theme, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, themes.length)) * Math.PI * 2;
    placed.set(theme.key, {
      ...theme,
      x: cx + Math.cos(angle) * themeRing,
      y: cy + Math.sin(angle) * themeRing,
      radius: 9 + Math.sqrt(theme.count) * 2.2,
      angle,
      ring: 1,
    });
  });

  // Треки — внешнее кольцо. Дуга трека пропорциональна числу его заметок, а не
  // равна всем: иначе 27 докладов «Без трека» и 2 кейноута получили бы по
  // одинаковому сектору, и точки слиплись бы в одном месте.
  const total = Math.max(1, graph.notes.length);
  const placedNotes: PlacedNote[] = [];
  let cursor = -Math.PI / 2;

  tracks.forEach((track) => {
    const count = Math.max(1, track.count);
    const span = (count / total) * Math.PI * 2;
    const arcStart = cursor;
    const arcEnd = cursor + span;
    const angle = (arcStart + arcEnd) / 2;
    cursor = arcEnd;

    placed.set(track.key, {
      ...track,
      x: cx + Math.cos(angle) * trackRing,
      y: cy + Math.sin(angle) * trackRing,
      radius: 12 + Math.sqrt(track.count) * 2.8,
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
        x: cx + Math.cos(noteAngle) * noteRing,
        y: cy + Math.sin(noteAngle) * noteRing,
      });
    });
  });

  const maxWeight = Math.max(1, ...graph.edges.map((edge) => edge.weight));
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
        // Толщина в px: 0.8 — самое слабое ребро, 3.2 — самое сильное. Пол
        // нужен, чтобы связь из одного доклада не исчезла в рендере.
        width: 0.8 + 2.4 * (edge.weight / maxWeight),
      },
    ];
  });

  return { width, height, hubs: [...placed.values()], notes: placedNotes, edges };
}
