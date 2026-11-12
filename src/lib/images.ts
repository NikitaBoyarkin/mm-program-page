import { existsSync } from "node:fs";
import path from "node:path";
import photoIndex from "../data/photos.json";

/**
 * Баннеры и аватарки: единственное место, где из URL первоисточника делается
 * уменьшенный вариант.
 *
 * Замер до этой правки (страница первого дня, 33 баннера): 324 КБ в среднем на
 * карточку шириной 310–390 px. Оригиналы — PNG на 1200×900, отданные целиком.
 *
 * Почему только один хост получает варианты. Из трёх CDN первоисточника
 * (`IMAGE_HOSTS` в `program-core.ts`) трансформировать умеет ровно один:
 * `mm-graphics.netlify.app` — это сайт на Netlify, у которого работает
 * встроенный Image CDN (`/.netlify/images?url=…&w=…&fm=webp&q=…`). У
 * `img.matemarketing.ru` и `storage.yandexcloud.net` параметров ресайза нет:
 * `?w=72` и `?width=72` возвращают те же байты (проверено), а Yandex Object
 * Storage раздаёт статику без обработки. Проксировать чужие хосты через
 * Netlify нельзя: `url=https://…` отвечает 400 «not an allowed pattern», то есть
 * белый список удалённых картинок настроен только на свой сайт.
 *
 * Поэтому функция возвращает либо `{ src }` (оригинал, как было), либо
 * `{ src, srcset, sizes }` — с вариантами. `src` остаётся оригиналом всегда:
 * это фолбэк для браузера без WebP и точка правды для тестов, которые сверяют
 * `image`/`photo` с белым списком хостов.
 */

/** Ширина карточки в сетке: `--mm-hall-min` 310 … 390 px (`program.css`). */
const BANNER_WIDTHS = [400, 800] as const;

/**
 * `sizes` описывает ту же геометрию, что CSS: до 1280 px карточка не шире
 * минимальной колонки, дальше — до 390. Ниже 768 px баннер скрыт
 * (`.talk-card__media` в мобильной модели), поэтому узкие кандидаты не нужны.
 */
export const BANNER_SIZES = "(min-width: 1280px) 390px, 310px";

/** Хост, у которого есть Image CDN, и путь к нему. */
const NETLIFY_IMAGE_HOST = "mm-graphics.netlify.app";
const NETLIFY_IMAGE_PATH = "/.netlify/images";

/** Качество и формат варианта: WebP q72 даёт ~8× меньше байт на глаз без потерь. */
const NETLIFY_QUERY = { fm: "webp", q: "72" } as const;

export interface BannerSources {
  /** Оригинал из данных. Всегда пригоден как `<img src>`. */
  src: string;
  /** Кандидаты через Image CDN; `undefined`, если хост не умеет. */
  srcset?: string;
  /** Подпись ширины для `srcset`; `undefined` вместе с ним. */
  sizes?: string;
}

/** Один вариант через Netlify Image CDN. Путь — от корня того же сайта. */
function netlifyVariant(path: string, width: number): string {
  const query = new URLSearchParams({
    url: path,
    w: String(width),
    ...NETLIFY_QUERY,
  });
  return `https://${NETLIFY_IMAGE_HOST}${NETLIFY_IMAGE_PATH}?${query.toString()}`;
}

/**
 * Префикс `base` проекта — тот же, с которым Astro переписывает `url()` в CSS.
 * При `bun test` `import.meta.env` нет, поэтому фолбэк на корень: адреса
 * локальных вариантов проверяются тестом, а не сборкой.
 */
const BASE = ((import.meta.env?.BASE_URL as string | undefined) ?? "/").replace(/\/+$/, "");

/**
 * Аватарки спикеров: локальные варианты из `public/media/lectors`.
 *
 * Карта `src/data/photos.json` — «оригинал → `/media/lectors/<hash>.webp`» —
 * производится `scripts/optimize-photos.ts` (`prebuild`). Наличие файла
 * проверяется на диске: карта коммитится, а сами webp генерируются, поэтому на
 * свежем клоне без прогона скрипта честнее отдать оригинал, чем битую картинку.
 *
 * Только для разметки карточки. В `/program.json` локальный путь НЕ уезжает:
 * клиент валидирует `photo` через `imageUrl()` (`program-core.ts`), а тот
 * отвергает относительный адрес и оставил бы модалку без аватарки вовсе
 * (поймано на ревью диффа). Модалка качает оригинал — это одно изображение по
 * действию пользователя, а не 32 на страницу.
 */
let photoMap: Record<string, string> | null = null;

/** Запись карты без проверки диска: тестируемо на свежем клоне, где webp нет. */
export function photoMapEntry(url: string): string | null {
  if (photoMap === null) photoMap = photoIndex as Record<string, string>;
  return photoMap[url] ?? null;
}

function localPhotoPath(url: string): string | null {
  const local = photoMapEntry(url);
  if (!local) return null;
  return existsSync(path.join(process.cwd(), "public", local)) ? `${BASE}${local}` : null;
}

/** `src` для аватарки: локальный вариант, если он есть, иначе оригинал. */
export function photoSources(url: string | null): string | null {
  if (!url) return null;
  return localPhotoPath(url) ?? url;
}


/** Варианты для `<img>`/`<link rel=preload>`. `null` — если картинки нет. */
export function bannerSources(url: string | null): BannerSources | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // `imageUrl` уже отбросил такое, но функция не должна падать на мусоре.
    return { src: url };
  }

  const transformable =
    parsed.protocol === "https:" &&
    parsed.hostname === NETLIFY_IMAGE_HOST &&
    !parsed.pathname.startsWith(NETLIFY_IMAGE_PATH);

  if (!transformable) return { src: url };

  const path = `${parsed.pathname}${parsed.search}`;
  return {
    src: url,
    srcset: BANNER_WIDTHS.map((width) => `${netlifyVariant(path, width)} ${width}w`).join(", "),
    sizes: BANNER_SIZES,
  };
}
