/**
 * Пакер подписей колец. Вынесен из `TalksGraph.astro`: здесь только геометрия
 * и оценка ширины, разметки нет, поэтому модуль проверяем и переиспользуем.
 *
 * Ширина считается по числу знаков — точный замер в SVG на билде недоступен, —
 * и по **мобильному** кеглю: на ≤767.98 px подписи вырастают до 13/14 px
 * (`talks-graph.css`), и коробка, посчитанная под 11/12 px, оказывалась на
 * 18 % уже настоящей.
 */
import type { PlacedHub } from "./talks-layout";

/** Якорь считается по знаку реального смещения точки привязки относительно
 *  центра хаба, а не по стороне света. Раньше знак брался у косинуса и затем
 *  инвертировался «чтобы текст уходил от центра», но у тем смещение идёт
 *  наружу — и подпись разворачивалась внутрь, ложась на собственный круг. */
const anchorFor = (dx: number): "start" | "middle" | "end" => {
  if (Math.abs(dx) < 0.25) return "middle";
  return dx > 0 ? "start" : "end";
};

/* ── Пакер подписей ──────────────────────────────────────────────────────────
   У хаба 12 подписей, и два трека могут стоять в 20 px друг от друга (дуга
   пропорциональна числу докладов: у KEYNOTES их 2, у HR-трека 4). Поэтому
   подпись не просто садится на фиксированный радиус, а ищет свободную полосу:
   первый радиус, чей прямоугольник не пересекает уже занятые. Ширина считается
   по числу знаков — точный замер в SVG на билде недоступен, а для 11px
   капители оценка 6.2px/знак держит запас. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Claim {
  box: Box;
  /** Хаб, которому принадлежит прямоугольник: свой круг подпись не обходит. */
  key?: string;
}

// Оценка ширины знака — по **мобильному** кеглю: на ≤767.98 px подписи
// вырастают до 13/14 px (talks.css), и коробка, посчитанная для 11/12 px,
// оказывалась на 18 % уже настоящей — подписи, разведённые на десктопе,
// налезали друг на друга на телефоне. Десктоп с этим запасом читается только
// свободнее. Замер в SVG на билде недоступен, поэтому запас в плюс.
export const THEME_CHAR_W = 10.2;
export const TRACK_CHAR_W = 10.3;
export const LABEL_H = 18;

/** Координата с двумя знаками — тот же приём, что в `talks-layout.ts`: без
 *  округления в разметку уходили хвосты вида `564.8083003999432`. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

const overlaps = (a: Box, b: Box): boolean =>
  !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);

/** Длинное имя («Семантический слой и аналитические агенты» — 254 px,
 *  «Безопасность и приватность» — 160 px) не влезает ни на одну полосу между
 *  кольцами: режем по слову, а полное имя остаётся в `<title>` круга и в
 *  заголовке раздела заметок ниже. */
const shorten = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 6 ? cut.slice(0, space) : cut}…`;
};

/** Выноска к подписи, которая уехала далеко от своего узла: у нижнего полюса
 *  сдвиги доходят до ±98 px, и подпись «Маркетинговая аналитика» читалась как
 *  подпись соседнего трека. Линия рисуется только когда зазор больше 12 px —
 *  вплотную стоящую подпись она бы только пачкала. */
const leaderFor = (
  hub: PlacedHub,
  x: number,
  y: number,
  anchor: string,
): { x1: number; y1: number; x2: number; y2: number } | null => {
  // Базовая линия текста — не его середина: центрируем по оптической оси.
  const midY = y - 6;
  const edgeX = anchor === "start" ? x - 2 : anchor === "end" ? x + 2 : x;
  const dx = edgeX - hub.x;
  const dy = midY - hub.y;
  const length = Math.hypot(dx, dy);
  if (length < hub.radius + 12) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: round2(hub.x + ux * (hub.radius + 2)),
    y1: round2(hub.y + uy * (hub.radius + 2)),
    x2: round2(edgeX - ux * 6),
    y2: round2(midY - uy * 6),
  };
};

/**
 * Раскладка подписей: подпись садится на первый радиус из списка, чей
 * прямоугольник не пересекает уже занятые. Занятые — круги хабов (кроме своего)
 * и уже посаженные подписи; без кругов подпись ложилась на чужой узел.
 * Смещения отсчитываются от радиуса своего круга: фиксированные 7 и 10 px были
 * меньше самого круга (14.8–25.4), и первая полоса у всех 23 хабов попадала
 * внутрь диска.
 */
export function placeLabels(
  hubs: PlacedHub[],
  options: { direction: 1 | -1; maxLength: number; charWidth: number },
  claimed: Claim[],
  ringLabel: (hub: PlacedHub) => string,
): Array<{
  hub: PlacedHub;
  text: string;
  x: number;
  y: number;
  anchor: string;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}> {
  // Длинные подписи садятся первыми: короткая найдёт свободное место где угодно,
  // а 170-пиксельная у нижнего полюса упиралась в занятые полосы и падала на
  // самый дальний радиус поверх соседа.
  const order = [...hubs].sort(
    (a, b) => ringLabel(b).length - ringLabel(a).length || a.key.localeCompare(b.key),
  );

  const placed = order.map((hub) => {
    const text = shorten(ringLabel(hub), options.maxLength);
    const width = text.length * options.charWidth;
    const ux = Math.cos(hub.angle);
    const uy = Math.sin(hub.angle);
    const dx = options.direction * ux;
    const anchor = anchorFor(dx);

    // Сдвиг по касательной: трёх радиальных полос мало — четыре подписи
    // садились друг на друга. Угловое смещение двигает подпись вдоль кольца,
    // не меняя полосы.
    const at = (offset: number, shift = 0) => {
      const x = round2(hub.x + options.direction * ux * offset - uy * shift);
      const y = round2(hub.y + options.direction * uy * offset + ux * shift + 4);
      const box: Box =
        anchor === "start"
          ? { x0: x, x1: x + width, y0: y - LABEL_H, y1: y + 4 }
          : anchor === "end"
            ? { x0: x - width, x1: x, y0: y - LABEL_H, y1: y + 4 }
            : { x0: x - width / 2, x1: x + width / 2, y0: y - LABEL_H, y1: y + 4 };
      return { x, y, box };
    };

    // Полосы между кольцами конечны: темы живут в 134–180, треки — в 196–242
    // от центра, поэтому третья полоса упирается в границу своей полосы, а не
    // уезжает на чужое кольцо. Шаг 20 px при коробке 18 px — это зазор 2 px;
    // шаг 16 при высоте 16 давал подписи впритык, и они читались слипшимися.
    const near = Math.min(30, hub.radius + 5);
    // У треков четвёртая полоса глубже: две длинные подписи у нижнего полюса
    // не разводились тремя.
    const offsets = [near, Math.min(50, near + 20), options.direction === 1 ? 52 : 50, 64];

    // ±56…±98 нужны длинным подписям у полюсов: две подписи по ~120 px с
    // центрами в 50 px друг от друга по x не разводятся сдвигом ±42.
    const slots = offsets.flatMap((offset) =>
      [0, 14, -14, 28, -28, 42, -42, 56, -56, 70, -70, 84, -84, 98, -98].map((shift) => ({ offset, shift })),
    );

    for (const slot of slots) {
      const { x, y, box } = at(slot.offset, slot.shift);
      // Свой круг тоже препятствие: угловой сдвиг может завести подпись назад
      // на собственный диск. Полоса `radius + 5` без сдвига проходит всегда.
      if (claimed.some((claim) => claim.key !== `label:${hub.key}` && overlaps(box, claim.box))) continue;
      claimed.push({ box, key: `label:${hub.key}` });
      return { hub, text, x, y, anchor, leader: leaderFor(hub, x, y, anchor) };
    }

    // Все полосы заняты. Раньше подпись садилась на самый дальний радиус —
    // то есть ровно поверх соседа. Теперь — слот с **наименьшим** перекрытием:
    // наезд остаётся, но минимальный, а не максимальный.
    let best: { x: number; y: number; box: Box; area: number } | null = null;
    for (const slot of slots) {
      const candidate = at(slot.offset, slot.shift);
      const area = claimed.reduce((sum, claim) => {
        const ox = Math.min(candidate.box.x1, claim.box.x1) - Math.max(candidate.box.x0, claim.box.x0);
        const oy = Math.min(candidate.box.y1, claim.box.y1) - Math.max(candidate.box.y0, claim.box.y0);
        return ox > 0 && oy > 0 ? sum + ox * oy : sum;
      }, 0);
      if (!best || area < best.area) best = { ...candidate, area };
    }
    const fallback = best ?? { ...at(offsets[offsets.length - 1] as number), area: 0 };
    claimed.push({ box: fallback.box, key: `label:${hub.key}` });
    return {
      hub,
      text,
      x: fallback.x,
      y: fallback.y,
      anchor,
      leader: leaderFor(hub, fallback.x, fallback.y, anchor),
    };
  });

  // Рендер идёт в исходном порядке хабы (по числу заметок), не в порядке посадки.
  return hubs.map((hub) => placed.find((label) => label.hub.key === hub.key) as (typeof placed)[number]);
}

