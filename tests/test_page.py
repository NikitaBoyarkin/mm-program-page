"""Browser-level contract checks for the static program page — standard library only.

    python3 tests/test_page.py                            # полный прогон
    MM_PAGE_ROOT=/tmp/broken python3 tests/test_page.py   # mutation control

Каждый тест — утверждение о реально отрендеренном DOM: страница открывается в
headless Chrome, `--dump-dom` забирает уже собранную сетку, дальше обычный
`html.parser` считает классы и атрибуты. Никаких npm/Playwright/Puppeteer и
никаких сетевых запросов: DNS внутри браузера погашен
(`--host-resolver-rules`), поэтому битые CDN-картинки и шрифты не делают
прогон флаки.

Практические грабли, из-за которых это работает не сразу:
  * без `--user-data-dir` Chrome на macOS вешается на повторном запуске;
  * полный скриншот требует `--window-size=W,H` с запасом по высоте;
  * окно уже ~500 px headless не открывает, поэтому 390 px рендерится
    внутри iframe-обёртки из временного каталога.
"""

from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import zlib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(os.environ.get("MM_PAGE_ROOT") or Path(__file__).resolve().parent.parent)
PAGE = ROOT / "index.html"
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]
CHROME = next((path for path in CHROME_CANDIDATES if path and Path(path).exists()), "")

# 8 с виртуального времени: рендер успевает отработать, а ожидание сети (её нет)
# не превращается в реальные секунды.
BASE_FLAGS = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--mute-audio",
    "--hide-scrollbars",
    "--virtual-time-budget=8000",
    "--host-resolver-rules=MAP * ~NOTFOUND",
]
CHROME_TIMEOUT = 90

DAY1_CARDS, DAY2_CARDS, ONLINE_CARDS = 39, 37, 15
DAY1_HALLS, DAY2_HALLS, ONLINE_HALLS = 5, 5, 3
TRACK_CHIPS = 11
TAB_LABELS = ["1 день (26 ноября)", "2 день (27 ноября)", "Онлайн-день (17 ноября)"]

PLACEHOLDER_RE = re.compile(
    r"\[object Object\]|(?<![0-9A-Za-z])undefined(?![0-9A-Za-z])"
    r"|(?<![0-9A-Za-z])NaN(?![0-9A-Za-z])|(?<![0-9A-Za-z])null(?![0-9A-Za-z])"
)
GRID_AREA_RE = re.compile(r"grid-area:\s*(\d+)\s*/\s*(\d+)\s*(?:/\s*span\s+(\d+))?")

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}

_TMP_ROOT = ""
_STARTED_AT = 0.0
_DOM_CACHE = {}


# ── HTML: минимальное дерево поверх html.parser ─────────────────────


class Node:
    __slots__ = ("tag", "attrs", "kids", "chunks")

    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = attrs
        self.kids = []
        self.chunks = []

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def has_class(self, name):
        return name in self.classes


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#document", {})
        self._stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs))
        self._stack[-1].kids.append(node)
        if tag not in VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self._stack[-1].kids.append(Node(tag, dict(attrs)))

    def handle_endtag(self, tag):
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == tag:
                del self._stack[index:]
                return

    def handle_data(self, data):
        self._stack[-1].chunks.append(data)


def parse_html(text):
    builder = TreeBuilder()
    builder.feed(text)
    builder.close()
    return builder.root


def walk(node):
    yield node
    for kid in node.kids:
        yield from walk(kid)


def by_class(root, name):
    return [node for node in walk(root) if node.has_class(name)]


def by_attr(root, name):
    return [node for node in walk(root) if name in node.attrs]


def text_raw(node):
    """Ровно то, что видно: textContent поддерева без script/style."""
    buffer = []

    def rec(current):
        if current.tag in ("script", "style"):
            return
        buffer.extend(current.chunks)
        for kid in current.kids:
            rec(kid)

    rec(node)
    return re.sub(r"\s+", " ", "".join(buffer)).strip()


# ── Chrome ──────────────────────────────────────────────────────────


def chrome_run(extra_args):
    cmd = [CHROME] + BASE_FLAGS + extra_args
    try:
        return subprocess.run(cmd, capture_output=True, timeout=CHROME_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise AssertionError(
            "Chrome не ответил за %s с: %s" % (CHROME_TIMEOUT, " ".join(cmd))
        )


def fresh_profile():
    return tempfile.mkdtemp(prefix="chrome-profile-", dir=_TMP_ROOT)


def dump_dom(url):
    if url in _DOM_CACHE:
        return _DOM_CACHE[url]
    profile = fresh_profile()
    try:
        proc = chrome_run(["--user-data-dir=" + profile, "--window-size=1440,1200",
                           "--dump-dom", url])
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    html = proc.stdout.decode("utf-8", "replace")
    if proc.returncode != 0 or not html.strip():
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-5:]
        raise AssertionError(
            "Chrome не отдал DOM для %s (код %s)\n%s" % (url, proc.returncode, "\n".join(tail))
        )
    _DOM_CACHE[url] = html
    return html


def take_screenshot(url, size, path):
    profile = fresh_profile()
    try:
        chrome_run(["--user-data-dir=" + profile, "--window-size=%d,%d" % size,
                    "--screenshot=" + str(path), url])
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return path


# ── PNG: ширина/высота + плотность пикселей (без Pillow) ────────────


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("это не PNG: сигнатура %r" % data[:8])
    return struct.unpack(">II", data[16:24])


def png_pixels(path):
    """Декодирует 8-битный RGB/RGBA PNG без интерлейса в список строк."""
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("это не PNG: сигнатура %r" % data[:8])
    pos, idat = 8, []
    width = height = depth = color = interlace = 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            idat.append(payload)
        elif kind == b"IEND":
            break
    if depth != 8 or color not in (2, 6) or interlace != 0:
        raise AssertionError(
            "неожиданный формат PNG: depth=%s color=%s interlace=%s" % (depth, color, interlace)
        )
    channels = 3 if color == 2 else 4
    stride = width * channels
    raw = zlib.decompress(b"".join(idat))
    rows, prev, pos = [], bytearray(stride), 0
    for _ in range(height):
        filt = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filt == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 0xFF
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif filt == 3:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 0xFF
        elif filt == 4:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                up = prev[x]
                corner = prev[x - channels] if x >= channels else 0
                estimate = left + up - corner
                da, db, dc = abs(estimate - left), abs(estimate - up), abs(estimate - corner)
                pred = left if (da <= db and da <= dc) else (up if db <= dc else corner)
                line[x] = (line[x] + pred) & 0xFF
        rows.append(line)
        prev = line
    return width, height, channels, rows


def pixel_density(path, x_limit=None, step=4):
    """Доля пикселей, отличных от самого частого цвета, и число цветов."""
    width, height, channels, rows = png_pixels(path)
    span = width if x_limit is None else min(width, int(x_limit))
    counts = {}
    for y in range(0, height, step):
        line = rows[y]
        for x in range(0, span, step):
            pixel = bytes(line[x * channels:(x + 1) * channels])
            counts[pixel] = counts.get(pixel, 0) + 1
    total = sum(counts.values())
    modal = max(counts.values())
    return {
        "total": total,
        "distinct": len(counts),
        "non_modal_share": (total - modal) / total,
        "pixels": (width, height),
        "sampled_width": span,
    }


# ── фикстуры страниц ────────────────────────────────────────────────


def page_url(day=None):
    url = PAGE.resolve().as_uri()
    return url + ("?day=" + str(day) if day is not None else "")


def day_root(day=None):
    return parse_html(dump_dom(page_url(day)))


def grid_cells(root):
    """Все ячейки [data-grid], у которых есть grid-area, как (node, style)."""
    grid = by_attr(root, "data-grid")
    if not grid:
        raise AssertionError("в DOM нет [data-grid]")
    cells = []
    for node in walk(grid[0]):
        if node.has_class("program-grid__time-cell") or node.has_class("program-grid__talk-cell"):
            cells.append((node, node.attrs.get("style", "")))
    return cells


def degradation_page(directory):
    """Копия index.html с пустыми данными: сообщение вместо сетки."""
    source = PAGE.read_text(encoding="utf-8")
    source = source.replace('src="data/program.js"', 'src="program.js"')
    base = ROOT.resolve().as_uri()
    source = re.sub(r'="(assets/[^"]+)"', lambda m: '="%s/%s"' % (base, m.group(1)), source)
    page = Path(directory) / "index.html"
    page.write_text(source, encoding="utf-8")
    (Path(directory) / "program.js").write_text(
        "window.MM_PROGRAM = {days: [], talks: []};\n", encoding="utf-8"
    )
    return page


# ── lifecycle ───────────────────────────────────────────────────────


def setUpModule():
    global _TMP_ROOT, _STARTED_AT
    _STARTED_AT = time.time()
    if not CHROME:
        raise unittest.SkipTest(
            "headless Chrome не найден — искали: " + ", ".join(p for p in CHROME_CANDIDATES if p)
        )
    if not PAGE.exists():
        raise unittest.SkipTest("нет index.html: %s" % PAGE)
    _TMP_ROOT = tempfile.mkdtemp(prefix="mm-program-tests-")


def tearDownModule():
    if _TMP_ROOT:
        shutil.rmtree(_TMP_ROOT, ignore_errors=True)
    if _STARTED_AT:
        sys.stderr.write("\n[test_page] Chrome: %s\n" % CHROME)
        sys.stderr.write("[test_page] всего %.1f с\n" % (time.time() - _STARTED_AT))


class ProgramPageRendering(unittest.TestCase):
    """Дни, счётчик, карточки, сетка и отсутствие заглушек в тексте."""

    # 1
    def test_day1_default_render(self):
        root = day_root()
        cards = by_class(root, "talk-card")
        halls = by_class(root, "program-grid__hall-name")
        chips = by_class(root, "track-chip")
        tabs = by_class(root, "program-tab")

        self.assertEqual(len(cards), DAY1_CARDS,
                         "карточек первого дня: %d, ожидалось %d" % (len(cards), DAY1_CARDS))
        self.assertEqual(len(halls), DAY1_HALLS,
                         "заголовков залов: %d, ожидалось %d" % (len(halls), DAY1_HALLS))
        self.assertEqual(len(chips), TRACK_CHIPS,
                         "чипов треков: %d, ожидалось %d" % (len(chips), TRACK_CHIPS))
        self.assertEqual(len(tabs), 3, "табов дней: %d, ожидалось 3" % len(tabs))
        self.assertEqual([text_raw(tab) for tab in tabs], TAB_LABELS,
                         "подписи табов разошлись с контрактом")
        self.assertEqual(tabs[0].attrs.get("aria-selected"), "true",
                         "первый таб не помечен aria-selected=true")
        selected = [tab for tab in tabs if tab.attrs.get("aria-selected") == "true"]
        self.assertEqual(len(selected), 1,
                         "активных табов %d, должен быть ровно один" % len(selected))

    # 2
    def test_day2_and_online_day(self):
        for day, cards_expected, halls_expected in (
            (11, DAY2_CARDS, DAY2_HALLS),
            (12, ONLINE_CARDS, ONLINE_HALLS),
        ):
            with self.subTest(day=day):
                root = day_root(day)
                cards = by_class(root, "talk-card")
                halls = by_class(root, "program-grid__hall-name")
                self.assertEqual(len(cards), cards_expected,
                                 "?day=%s: карточек %d, ожидалось %d"
                                 % (day, len(cards), cards_expected))
                self.assertEqual(len(halls), halls_expected,
                                 "?day=%s: залов %d, ожидалось %d"
                                 % (day, len(halls), halls_expected))

                counter = by_attr(root, "data-viewers-count")
                self.assertEqual(len(counter), 1,
                                 "?day=%s: [data-viewers-count] найден %d раз" % (day, len(counter)))
                shown = text_raw(counter[0])
                self.assertRegex(shown, r"^\d+$",
                                 "?day=%s: счётчик показывает %r вместо числа" % (day, shown))
                self.assertEqual(int(shown), len(cards),
                                 "?day=%s: счётчик %s не равен числу карточек %d"
                                 % (day, shown, len(cards)))

                active = [tab for tab in by_class(root, "program-tab")
                          if tab.attrs.get("aria-selected") == "true"]
                self.assertEqual(len(active), 1,
                                 "?day=%s: активных табов %d" % (day, len(active)))
                self.assertEqual(text_raw(active[0]), TAB_LABELS[{11: 1, 12: 2}[day]],
                                 "?day=%s: активен не тот таб" % day)

    # 3
    def test_no_placeholder_text(self):
        for day in (None, 11, 12):
            with self.subTest(day=day):
                root = day_root(day)
                scopes = (by_attr(root, "data-grid") + by_attr(root, "data-tabs")
                          + by_attr(root, "data-tracks"))
                self.assertGreaterEqual(len(scopes), 3,
                                        "?day=%s: не нашлись хуки data-grid/data-tabs/data-tracks"
                                        % day)
                visible = " ".join(text_raw(scope) for scope in scopes)
                self.assertGreater(len(visible), 50,
                                   "?day=%s: в сетке и табах почти нет текста: %r"
                                   % (day, visible[:120]))
                found = PLACEHOLDER_RE.findall(visible)
                self.assertEqual(found, [],
                                 "?day=%s: в видимом тексте заглушки %s"
                                 % (day, sorted(set(found))))

    # 4
    def test_every_card_has_visible_title(self):
        for day in (None, 11, 12):
            with self.subTest(day=day):
                root = day_root(day)
                cards = by_class(root, "talk-card")
                self.assertTrue(cards, "?day=%s: карточек нет вообще" % day)
                empty = []
                for index, card in enumerate(cards):
                    title = next((node for node in walk(card)
                                  if node.has_class("talk-card__topic-title")), None)
                    banner = next((node for node in walk(card)
                                   if node.tag == "img"
                                   and node.has_class("talk-card__banner-img")), None)
                    has_title = bool(title is not None and text_raw(title))
                    has_banner = bool(banner is not None
                                      and (banner.attrs.get("alt") or "").strip())
                    if not (has_title or has_banner):
                        empty.append((index, card.attrs.get("data-talk-id"),
                                      text_raw(card)[:60]))
                self.assertEqual(empty, [],
                                 "?day=%s: пустые карточки (index, talk-id, текст): %s"
                                 % (day, empty[:5]))
                nameless = [card.attrs.get("data-talk-id") for card in cards
                            if not (card.attrs.get("aria-label") or "").strip()]
                self.assertEqual(nameless, [],
                                 "?day=%s: у карточек нет доступного имени: %s"
                                 % (day, nameless[:5]))

    # 5
    def test_grid_geometry_is_sound(self):
        for day in (None, 11, 12):
            with self.subTest(day=day):
                root = day_root(day)
                cells = grid_cells(root)
                self.assertTrue(cells, "?day=%s: в [data-grid] нет ячеек" % day)

                missing, parsed = [], []
                for index, (node, style) in enumerate(cells):
                    match = GRID_AREA_RE.search(style)
                    if not match:
                        missing.append((index, node.classes, style[:60]))
                        continue
                    parsed.append((int(match.group(1)), int(match.group(2)), node))
                self.assertEqual(missing, [],
                                 "?day=%s: ячейки без grid-area: %s" % (day, missing[:5]))

                starts = [(row, col) for row, col, _ in parsed]
                duplicates = sorted({start for start in starts if starts.count(start) > 1})
                self.assertEqual(duplicates, [],
                                 "?day=%s: несколько ячеек в одном слоте %s" % (day, duplicates))

                halls = by_class(root, "program-grid__hall-name")
                columns = sorted({col for _, col, _ in parsed})
                self.assertEqual(len(columns), len(halls) + 1,
                                 "?day=%s: колонок %s при %d залах (ожидалось %d: время + залы)"
                                 % (day, columns, len(halls), len(halls) + 1))
                self.assertEqual(columns, list(range(1, len(halls) + 2)),
                                 "?day=%s: колонки не совпадают с 1..%d: %s"
                                 % (day, len(halls) + 1, columns))

                rows = sorted({row for row, _, _ in parsed})
                self.assertEqual(rows, list(range(1, len(rows) + 1)),
                                 "?day=%s: строки не идут подряд с 1: %s" % (day, rows))
                time_cells = [node for node in walk(by_attr(root, "data-grid")[0])
                              if node.has_class("program-grid__time-cell")]
                self.assertEqual(len(time_cells), len(rows),
                                 "?day=%s: строк времени %d, а строк сетки %d"
                                 % (day, len(time_cells), len(rows)))


class ProgramPageScreenshots(unittest.TestCase):
    """Скриншоты: страница действительно нарисована, а не пустой холст."""

    # 6
    def test_screenshots_desktop_and_narrow(self):
        desktop = Path(_TMP_ROOT) / "desktop-1440x1200.png"
        take_screenshot(page_url(), (1440, 1200), desktop)
        self.assertTrue(desktop.exists(), "Chrome не создал PNG 1440x1200")
        data = desktop.read_bytes()
        width, height = png_size(data)
        self.assertGreater(width, 1000, "скриншот шириной %d px — меньше 1000" % width)
        self.assertGreaterEqual(height, 1200, "скриншот высотой %d px — обрезан" % height)
        self.assertGreater(len(data), 50 * 1024,
                           "PNG весит %.1f КБ — меньше 50 КБ, похоже на пустую страницу"
                           % (len(data) / 1024))
        density = pixel_density(desktop, step=6)
        self.assertGreaterEqual(density["distinct"], 32,
                                "на скриншоте всего %d цветов — страница пустая"
                                % density["distinct"])
        self.assertGreater(density["non_modal_share"], 0.05,
                           "непустых пикселей %.1f%% — страница не отрисована"
                           % (density["non_modal_share"] * 100))

        # 390 px: headless не открывает окно уже ~500 px, поэтому страница
        # живёт в iframe шириной 390 внутри обёртки.
        wrapper = Path(_TMP_ROOT) / "narrow-390.html"
        wrapper.write_text(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>"
            "html,body{margin:0;padding:0;background:#fff}"
            "iframe{width:390px;height:900px;border:0;display:block}"
            "</style></head><body><iframe src=\"%s\" title=\"390px\"></iframe></body></html>"
            % page_url(),
            encoding="utf-8",
        )
        narrow = Path(_TMP_ROOT) / "narrow-390x900.png"
        take_screenshot(wrapper.resolve().as_uri(), (520, 900), narrow)
        self.assertTrue(narrow.exists(), "Chrome не создал PNG 390x900")
        narrow_width, narrow_height = png_size(narrow.read_bytes())
        self.assertGreaterEqual(narrow_width, 390, "PNG уже 390 px: %d" % narrow_width)
        self.assertGreaterEqual(narrow_height, 800, "PNG ниже 800 px: %d" % narrow_height)
        narrow_density = pixel_density(narrow, x_limit=390, step=2)
        self.assertGreaterEqual(narrow_density["distinct"], 32,
                                "в полосе 390 px всего %d цветов — iframe пустой"
                                % narrow_density["distinct"])
        self.assertGreater(narrow_density["non_modal_share"], 0.05,
                           "в полосе 390 px непустых пикселей %.1f%% — страница не отрисована"
                           % (narrow_density["non_modal_share"] * 100))

    # 7
    def test_graceful_degradation_without_data(self):
        directory = tempfile.mkdtemp(prefix="degraded-", dir=_TMP_ROOT)
        page = degradation_page(directory)
        root = parse_html(dump_dom(page.resolve().as_uri()))

        messages = by_class(root, "program-grid__message")
        self.assertEqual(len(messages), 1,
                         "при пустых данных нет одного сообщения в сетке: %s"
                         % [text_raw(node) for node in messages])
        message = text_raw(messages[0])
        self.assertIn("Не удалось загрузить программу", message,
                      "сообщение о пустых данных не показано: %r" % message)

        self.assertEqual(by_class(root, "talk-card"), [],
                         "при пустых данных всё равно отрисовались карточки")

        headings = by_class(root, "header__heading")
        self.assertTrue(headings and "Программа Матемаркетинг 2026" in text_raw(headings[0]),
                        "каркас страницы не отрисован — похоже на падение JS")

        counter = by_attr(root, "data-viewers-count")
        self.assertEqual(len(counter), 1, "[data-viewers-count] потерялся")
        self.assertEqual(text_raw(counter[0]), "0",
                         "счётчик при пустых данных показывает %r" % text_raw(counter[0]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
