/**
 * Граф докладов: темы, атомарные заметки, связи и раскладка.
 *
 * Тесты делятся на два блока. Первый проверяет модель на реальном слепке
 * (91 доклад): темы, число хабов, вес рёбер, покрытие связями. Второй — на
 * синтетических заметках: детерминизм, симметрия, границы раскладки. Смысл
 * разделения: данные меняются при `data:fetch`, а инварианты модели — нет.
 */
import { describe, expect, test } from "bun:test";
import { PROGRAM, days } from "../../src/lib/program";
import {
  THEMES,
  buildGraph,
  buildNotes,
  layoutGraph,
  notesByTheme,
  notesByTrack,
  relatedNotes,
  themeLabel,
  themesOf,
  trackHubKey,
  type TalkNote,
} from "../../src/lib/talks-graph";

const dayOrdinal = new Map(days().map((day, index) => [day.id, index + 1] as const));
const notes = buildNotes(PROGRAM.talks, {
  dayOrdinal,
  hrefOf: (ordinal, id) => `/day/${ordinal}/#t${id}`,
});
const graph = buildGraph(notes, PROGRAM.event.name);
const layout = layoutGraph(graph);
const related = relatedNotes(notes);

/** Синтетическая заметка: модель тестируется без слепка. */
const note = (id: number, track: string, themes: string[], start = "10:00"): TalkNote => ({
  id,
  key: `t${id}`,
  title: `Доклад ${id}`,
  hall: "Атом",
  start,
  end: "10:30",
  dayId: 1,
  track,
  trackId: null,
  themes,
  anchor: `t${id}`,
  dayOrdinal: 1,
  href: `/day/1/#t${id}`,
  lectors: [],
});

describe("темы", () => {
  test("словарь: 11 тем, уникальные id, подпись на двух языках и короткая форма для графа", () => {
    expect(THEMES.length).toBe(11);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(11);
    for (const theme of THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.labelEn.length).toBeGreaterThan(0);
      expect(theme.stems.length).toBeGreaterThan(0);
      // Короткая форма существует именно потому, что 11 полных названий не
      // влезают на кольцо: если она перестанет быть короткой, кольцо снова
      // начнёт перекрывать подписи.
      expect(theme.short.length).toBeGreaterThan(0);
      expect(theme.short.length).toBeLessThanOrEqual(14);
      expect(theme.shortEn.length).toBeGreaterThan(0);
      expect(theme.shortEn.length).toBeLessThanOrEqual(14);
    }
    expect(new Set(THEMES.map((theme) => theme.short)).size).toBe(THEMES.length);
  });

  test("подпись переводится, неизвестная тема возвращает свой id", () => {
    expect(themeLabel("ai", "en")).toBe("AI & agents");
    expect(themeLabel("ai", "ru")).toBe("AI и агенты");
    expect(themeLabel("no-such-theme", "ru")).toBe("no-such-theme");
  });

  test("themesOf узнаёт тему по словоформам и не путает двухбуквенный стем", () => {
    expect(themesOf({ title: "Как атрибуция врёт", short: "", description: "" })).toContain("marketing");
    expect(themesOf({ title: "A/B-тест на вырост", short: "", description: "" })).toContain("ab");
    // `bi` — короткий стем: он не должен цепляться за `bigtech`.
    expect(themesOf({ title: "Bigtech-масштаб и найм", short: "", description: "" })).not.toContain("bi");
    expect(themesOf({ title: "Пустой доклад", short: "", description: "" })).toEqual([]);
  });

  test("темы доклада всегда из словаря", () => {
    const known = new Set(THEMES.map((theme) => theme.id));
    for (const item of notes) for (const theme of item.themes) expect(known.has(theme)).toBe(true);
  });
});

describe("заметки", () => {
  test("91 заметка, уникальные id и постоянные адреса", () => {
    expect(notes.length).toBe(PROGRAM.talks.length);
    expect(new Set(notes.map((item) => item.id)).size).toBe(notes.length);
    for (const item of notes) {
      expect(item.key).toBe(`t${item.id}`);
      expect(item.anchor).toBe(`t${item.id}`);
      expect(item.href.endsWith(`#t${item.id}`)).toBe(true);
    }
  });

  test("каждая заметка привязана к своему дню и треку", () => {
    for (const item of notes) {
      expect(item.dayOrdinal).toBe(dayOrdinal.get(item.dayId) as number);
      expect(item.track.length).toBeGreaterThan(0);
      expect(item.href).toContain(`/day/${item.dayOrdinal}/`);
    }
  });

  test("порядок заметок — программа: день, затем время", () => {
    for (let index = 1; index < notes.length; index += 1) {
      const prev = notes[index - 1] as TalkNote;
      const next = notes[index] as TalkNote;
      const ordered =
        prev.dayOrdinal < next.dayOrdinal ||
        (prev.dayOrdinal === next.dayOrdinal && prev.start <= next.start);
      expect(ordered).toBe(true);
    }
  });
});

describe("хабы и рёбра", () => {
  test("хабы: событие, 11 треков + «Без трека», все 11 тем", () => {
    expect(graph.hubs.filter((hub) => hub.kind === "event").length).toBe(1);
    expect(graph.hubs.filter((hub) => hub.kind === "track").length).toBe(12);
    expect(graph.hubs.filter((hub) => hub.kind === "theme").length).toBe(11);
  });

  test("хаб трека несёт ровно столько заметок, сколько в нём есть", () => {
    for (const group of notesByTrack(graph)) {
      expect(group.hub.count).toBe(group.notes.length);
      for (const item of group.notes) expect(trackHubKey(item.track)).toBe(group.hub.key);
    }
    const covered = notesByTrack(graph).reduce((sum, group) => sum + group.notes.length, 0);
    expect(covered).toBe(notes.length);
  });

  test("рёбра: иерархия только событие → трек, темы — только хорды трек ↔ тема", () => {
    const core = graph.edges.filter((edge) => edge.kind === "core");
    const topic = graph.edges.filter((edge) => edge.kind === "topic");
    expect(core.length).toBe(12);
    for (const edge of core) expect(edge.from).toBe("event");
    for (const edge of topic) {
      expect(edge.from.startsWith("track:")).toBe(true);
      expect(edge.to.startsWith("theme:")).toBe(true);
    }
  });

  test("вес ребра трек ↔ тема равен числу докладов, несущих оба", () => {
    for (const edge of graph.edges.filter((item) => item.kind === "topic")) {
      const track = edge.from.replace("track:", "");
      const theme = edge.to.replace("theme:", "");
      const expected = notes.filter((item) => item.track === track && item.themes.includes(theme)).length;
      expect(edge.weight).toBe(expected);
    }
  });

  test("рёбер нет пар, которых нет в данных, и нет дублей", () => {
    const keys = graph.edges.map((edge) => `${edge.from}|${edge.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const edge of graph.edges.filter((item) => item.kind === "topic")) {
      expect(edge.weight).toBeGreaterThan(0);
    }
  });

  test("обратный индекс темы покрывает все доклады с этой темой", () => {
    for (const group of notesByTheme(graph)) {
      for (const item of group.notes) expect(item.themes).toContain(group.theme.id);
    }
    const withThemes = notes.filter((item) => item.themes.length > 0).length;
    const seen = new Set(notesByTheme(graph).flatMap((group) => group.notes.map((item) => item.id)));
    expect(seen.size).toBe(withThemes);
  });
});

describe("связанные заметки", () => {
  test("покрытие: у каждой заметки есть хотя бы одна связь, не больше k", () => {
    for (const item of notes) {
      const links = related.get(item.id) ?? [];
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.length).toBeLessThanOrEqual(4);
    }
  });

  test("у каждой связи есть постоянный адрес заметки", () => {
    for (const links of related.values()) {
      for (const link of links) {
        expect(link.href.endsWith(`#${link.anchor}`)).toBe(true);
        expect(link.href).toContain(`/day/${(notes.find((item) => item.id === link.id) as TalkNote).dayOrdinal}/`);
      }
    }
  });

  test("ссылка не ведёт на себя, без дублей, по убыванию веса", () => {
    for (const [id, links] of related) {
      expect(links.some((link) => link.id === id)).toBe(false);
      expect(new Set(links.map((link) => link.id)).size).toBe(links.length);
      for (let index = 1; index < links.length; index += 1) {
        expect((links[index - 1] as { score: number }).score).toBeGreaterThanOrEqual(
          (links[index] as { score: number }).score,
        );
      }
    }
  });

  test("у каждой связи есть причина: тема, трек или соседство в зале", () => {
    for (const links of related.values()) {
      for (const link of links) {
        const reason =
          link.sharedThemes.length > 0 || link.sameTrack || link.adjacent || link.score === 0;
        expect(reason).toBe(true);
      }
    }
  });

  test("связи считаются дважды одинаково: повторный вызов даёт тот же результат", () => {
    const again = relatedNotes(notes);
    expect(JSON.stringify([...again])).toBe(JSON.stringify([...related]));
  });

  test("связь по общей теме важнее связи по одному треку", () => {
    // Два доклада разных треков с двумя общими темами должны перевесить
    // пару «тот же трек, тем нет».
    const synthetic = [
      note(1, "Трек А", ["metrics", "product"]),
      note(2, "Трек Б", ["metrics", "product"], "11:00"),
      note(3, "Трек А", [], "12:00"),
    ];
    const map = relatedNotes(synthetic);
    const first = (map.get(1) ?? []).find((link) => link.id === 2);
    const sameTrack = (map.get(1) ?? []).find((link) => link.id === 3);
    expect(first?.score ?? 0).toBeGreaterThan(sameTrack?.score ?? 0);
  });
});

describe("инварианты сети", () => {
  test("связь не теряется молча: если B не ссылается на A, у B занят весь предел", () => {
    for (const [id, links] of related) {
      for (const link of links) {
        if (link.score === 0) continue;
        const back = related.get(link.id) ?? [];
        const reciprocal = back.some((item) => item.id === id);
        expect(
          reciprocal || back.length === 4,
          `A=${id} → B=${link.id} без обратной ссылки и без полного списка у B`,
        ).toBe(true);
      }
    }
  });

  test("два доклада «Без трека» не соседи по треку", () => {
    const untracked = [
      note(1, "Без трека", [], "10:00"),
      note(2, "Без трека", [], "11:00"),
    ];
    const map = relatedNotes(untracked);
    for (const links of map.values()) {
      for (const link of links) expect(link.sameTrack).toBe(false);
    }
    // Но связь всё равно есть: фолбэк «тот же день» держит узел в сети.
    expect((map.get(1) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("раскладка", () => {
  test("все хабы на месте, координаты внутри холста", () => {
    expect(layout.hubs.length).toBe(graph.hubs.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const hub of layout.hubs) {
      expect(hub.x).toBeGreaterThan(0);
      expect(hub.x).toBeLessThan(layout.width);
      expect(hub.y).toBeGreaterThan(0);
      expect(hub.y).toBeLessThan(layout.height);
    }
  });

  test("каждая заметка — точка на внешней дуге, и её хаб существует", () => {
    expect(layout.notes.length).toBe(notes.length);
    const hubKeys = new Set(layout.hubs.map((hub) => hub.key));
    for (const item of layout.notes) {
      expect(hubKeys.has(item.hubKey)).toBe(true);
      expect(item.x).toBeGreaterThan(0);
      expect(item.x).toBeLessThan(layout.width);
      expect(item.y).toBeGreaterThan(0);
      expect(item.y).toBeLessThan(layout.height);
    }
  });

  test("заметки не слипаются: минимальная дистанция по всем парам, а не по соседям в массиве", () => {
    let min = Number.POSITIVE_INFINITY;
    for (let a = 0; a < layout.notes.length; a += 1) {
      for (let b = a + 1; b < layout.notes.length; b += 1) {
        const first = layout.notes[a] as { x: number; y: number };
        const second = layout.notes[b] as { x: number; y: number };
        min = Math.min(min, Math.hypot(second.x - first.x, second.y - first.y));
      }
    }
    // Дуга поделена пропорционально числу докладов: ожидание ~20 px, порог
    // ловит слипание двух точек в одну (distance = 0) — тот случай, который
    // предыдущая версия теста пропускала.
    expect(min).toBeGreaterThan(8);
  });

  test("рёбра получают координаты и толщину, детерминизм сохраняется", () => {
    for (const edge of layout.edges) {
      expect(Number.isFinite(edge.x1)).toBe(true);
      expect(edge.width).toBeGreaterThan(0);
    }
    expect(JSON.stringify(layoutGraph(graph))).toBe(JSON.stringify(layout));
  });
});
