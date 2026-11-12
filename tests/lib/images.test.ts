/**
 * Доставка картинок: `src/lib/images.ts`.
 *
 * Два утверждения, которые до этого теста держались только прозой:
 *
 * 1. Баннер получает варианты ровно у того хоста, который умеет их отдавать.
 *    Netlify-хост — да (`/.netlify/images`), два других — нет: у них нет
 *    параметров ресайза (проверено: `?w=72` и `?width=72` возвращают те же
 *    байты), а проксировать их через Netlify нельзя — он отвечает 400 «not an
 *    allowed pattern». Значит `srcset` у чужого хоста был бы битой ссылкой,
 *    которая не скачивается вообще; тест его и запрещает.
 * 2. Локальные аватарки покрывают слепок. Карта `photos.json` — производная от
 *    `program.json`, и разъехаться они могут молча: новый спикер приезжает
 *    `data:fetch`, скрипт не перезапущен — и половина карточек снова тянет
 *    оригиналы по 500 КБ. Тест ловит именно этот перекос, а не наличие файлов
 *    на диске (их нет на свежем клоне — они генерируются `prebuild`).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import photos from "../../src/data/photos.json";
import program from "../../src/data/program.json";
import { BANNER_SIZES, bannerSources, photoMapEntry, photoSources } from "../../src/lib/images";

const ROOT = path.resolve(import.meta.dir, "../..");
const NETLIFY = "https://mm-graphics.netlify.app/banners/lms-1/statsenko.png";
const YANDEX =
  "https://storage.yandexcloud.net/matemarketing-prod-storage/media/courses/lectors/2026/10/23/a.webp";
const MATEMARTING = "https://img.matemarketing.ru/mm-graphics/lms-1/babushkin.png";

test("баннер netlify-хоста получает варианты WebP, оригинал остаётся src", () => {
  const sources = bannerSources(NETLIFY);
  expect(sources).not.toBeNull();
  expect(sources!.src).toBe(NETLIFY);
  expect(sources!.sizes).toBe(BANNER_SIZES);
  // Два кандидата — 400 и 800: карточка 310–390 px, DPR 1–2.
  expect(sources!.srcset).toContain("w=400");
  expect(sources!.srcset).toContain("w=800");
  expect(sources!.srcset).toContain("fm=webp");
  // Путь идёт параметром `url`, а не путём запроса: иначе Netlify ищет файл
  // по адресу зонтика и отдаёт 404.
  expect(sources!.srcset).toContain("url=%2Fbanners%2Flms-1%2Fstatsenko.png");
});

test("чужие хосты вариантов не получают: у них нет ресайза", () => {
  for (const url of [YANDEX, MATEMARTING]) {
    const sources = bannerSources(url);
    expect(sources!.src).toBe(url);
    expect(sources!.srcset).toBeUndefined();
    expect(sources!.sizes).toBeUndefined();
  }
});

test("готовый вариант не оборачивается вторым разом", () => {
  const already = `https://mm-graphics.netlify.app/.netlify/images?url=%2Fbanners%2Fx.png&w=400&fm=webp&q=72`;
  const sources = bannerSources(already);
  expect(sources!.srcset).toBeUndefined();
});

test("пустой баннер — null, мусор не роняет функцию", () => {
  expect(bannerSources(null)).toBeNull();
  expect(bannerSources("not a url")!.src).toBe("not a url");
});

test("каждая аватарка слепка имеет локальный вариант", () => {
  const snapshot = program as { talks: { lectors: { photo: string | null }[] }[] };
  const photosInData = new Set<string>();
  for (const talk of snapshot.talks) {
    for (const lector of talk.lectors) {
      if (lector.photo) photosInData.add(lector.photo);
    }
  }
  expect(photosInData.size).toBeGreaterThan(0);

  const missing = [...photosInData].filter((url) => !(url in photos));
  expect(missing, "запусти `bun run photos` и закоммить src/data/photos.json").toEqual([]);
});

test("карта не содержит ключей, которых нет в слепке", () => {
  const snapshot = program as { talks: { lectors: { photo: string | null }[] }[] };
  const photosInData = new Set<string>();
  for (const talk of snapshot.talks) {
    for (const lector of talk.lectors) {
      if (lector.photo) photosInData.add(lector.photo);
    }
  }
  const extra = Object.keys(photos).filter((url) => !photosInData.has(url));
  expect(extra, "перезапусти `bun run photos`, чтобы карта не росла мусором").toEqual([]);
});

test("photoSources: известный адрес ведёт на локальный файл, неизвестный — на оригинал", () => {
  const known = Object.keys(photos)[0]!;
  const local = photoSources(known);
  // Ровно две допустимые формы: локальный вариант с base или оригинал.
  // Третьей («сломанный путь») быть не может — и именно её ловил бы `if`.
  expect(local === known || /\/media\/lectors\/[0-9a-f]{12}\.webp$/.test(local ?? "")).toBe(true);

  const stranger = `${YANDEX}-unknown`;
  expect(photoSources(stranger)).toBe(stranger);
  expect(photoSources(null)).toBeNull();
});

test("карта ведёт только внутрь /media/lectors и только на webp", () => {
  // Путь в карте — единственное, что попадает в `src` разметки. Разрешаем ровно
  // ту форму, которую пишет скрипт: 12 hex-символов и `.webp`, без `..`.
  for (const [url, local] of Object.entries(photos)) {
    expect(local).toMatch(/^\/media\/lectors\/[0-9a-f]{12}\.webp$/);
    expect(url.startsWith("https://")).toBe(true);
  }
});

test("photoMapEntry не зависит от диска: карта читается и без сгенерированных файлов", () => {
  const known = Object.keys(photos)[0]!;
  expect(photoMapEntry(known)).toBe((photos as Record<string, string>)[known]);
  expect(photoMapEntry(`${known}-unknown`)).toBeNull();
});

test("карта — валидный JSON с отсортированными ключами", () => {
  const raw = readFileSync(path.join(ROOT, "src/data/photos.json"), "utf8");
  expect(JSON.parse(raw)).toEqual(photos);
  const keys = Object.keys(photos) as string[];
  expect([...keys].sort()).toEqual(keys);
});
