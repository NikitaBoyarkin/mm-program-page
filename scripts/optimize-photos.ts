/**
 * Локальные аватарки спикеров: скачать оригинал с CDN первоисточника один раз,
 * уменьшить до 144×144 и положить в `public/media/lectors/<hash>.webp`.
 *
 * Зачем. Замер страницы первого дня (Chromium, 390×844 и 1280×900): 32 аватарки
 * по 36 px в CSS отдавались файлами по 300–1200 КБ (528 КБ в среднем), то есть
 * 7.5–13.8 МБ трафика на один просмотр расписания. Хосты первоисточника ресайза
 * не умеют: `?w=72` и `?width=72` на `storage.yandexcloud.net` возвращают те же
 * байты, трансформировать умеет только Netlify-хост — и только свои файлы
 * (`url=https://…` отвечает 400 «not an allowed pattern»). Значит единственный
 * способ отдать 36-пиксельную картинку 36-пиксельными байтами — сделать вариант
 * самим.
 *
 * Что важно в поведении:
 * - файл уже на месте → не качаем повторно (имя = хеш URL), поэтому повторная
 *   сборка не тратит сеть;
 * - любая ошибка (таймаут, 404, битый файл) НЕ валит сборку: URL просто не
 *   попадает в `src/data/photos.json`, и разметка отдаёт оригинал, как раньше;
 * - `src/data/photos.json` коммитится: это карта «оригинал → локальный вариант»,
 *   по ней читают и карточка, и `/program.json` для модалки. Сами webp лежат в
 *   `public/media/lectors/` и не коммитятся (`prebuild` пересоберёт).
 *
 * Запуск: `bun run photos` (он же `prebuild`).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { IMAGE_HOSTS } from "../src/lib/program-core";

const ROOT = path.resolve(import.meta.dir, "..");
const DATA = path.join(ROOT, "src/data/program.json");
const MAP = path.join(ROOT, "src/data/photos.json");
const OUT_DIR = path.join(ROOT, "public/media/lectors");
/** Каталог для URL в разметке: `public/` отдаётся с корня сайта. */
const PUBLIC_PREFIX = "/media/lectors";

/** 144 px — это 36 px карточки при DPR 4 и 48 px в модалке при DPR 3. */
const SIZE = 144;
const QUALITY = 72;
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 2;
/** Потолок одного ответа: 1.2 МБ — самый большой оригинал в слепке. */
const MAX_BYTES = 8 * 1024 * 1024;

interface Snapshot {
  talks: { lectors: { photo: string | null }[] }[];
}

const log = (message: string) => console.log(`[photos] ${message}`);

/**
 * Тот же белый список, что у разметки (`imageUrl` в `program-core.ts`), плюс
 * проверка после редиректов: `fetch` следует за 30x, и адрес, разрешённый на
 * входе, мог уехать на чужой хост. Слепок приходит из чужого API, поэтому
 * строка оттуда не должна решать, куда стучится сборка.
 */
function allowedUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname)) return null;
  return url;
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  const checked = allowedUrl(url);
  if (!checked) {
    log(`skip ${url} — не из белого списка IMAGE_HOSTS`);
    return null;
  }
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(checked, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Редирект мог увести на другой хост — проверяем фактический адрес ответа.
      if (!allowedUrl(response.url)) throw new Error(`redirect to ${response.url}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new Error(`too large: ${declared} bytes`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error(`too large: ${bytes.byteLength} bytes`);
      return bytes;
    } catch (error) {
      if (attempt === ATTEMPTS) {
        log(`skip ${url} — ${(error as Error).message}`);
        return null;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function photoUrls(snapshot: Snapshot): string[] {
  const seen = new Set<string>();
  for (const talk of snapshot.talks) {
    for (const lector of talk.lectors) {
      if (lector.photo) seen.add(lector.photo);
    }
  }
  return [...seen].sort();
}

async function main(): Promise<void> {
  const snapshot = JSON.parse(await readFile(DATA, "utf8")) as Snapshot;
  const urls = photoUrls(snapshot);
  await mkdir(OUT_DIR, { recursive: true });

  const map: Record<string, string> = {};
  let downloaded = 0;
  let reused = 0;
  let failed = 0;

  // Параллельно по 6: CDN первоисточника держит единичное соединение ~1.8 с,
  // последовательный проход по 94 адресам занимал бы три минуты.
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
      const file = path.join(OUT_DIR, `${hash}.webp`);
      const publicPath = `${PUBLIC_PREFIX}/${hash}.webp`;

      if (existsSync(file)) {
        map[url] = publicPath;
        reused += 1;
        continue;
      }

      const bytes = await fetchBytes(url);
      if (!bytes) {
        failed += 1;
        continue;
      }

      try {
        // `cover` + `position: attention` держит лицо в кадре: оригиналы — портреты
        // и квадраты, а рамка карточки круглая.
        await sharp(bytes)
          .resize(SIZE, SIZE, { fit: "cover", position: sharp.strategy.attention })
          .webp({ quality: QUALITY })
          .toFile(file);
        map[url] = publicPath;
        downloaded += 1;
      } catch (error) {
        log(`skip ${url} — ${(error as Error).message}`);
        failed += 1;
      }
    }
  });
  await Promise.all(workers);

  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MAP, `${JSON.stringify(sorted, null, 2)}\n`);
  log(
    `готово: ${Object.keys(sorted).length}/${urls.length} карт, скачано ${downloaded}, из кеша ${reused}, пропущено ${failed}`,
  );
}

await main();
