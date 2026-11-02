"""Contract checks for `data/program.js` — standard library only.

    python3 tests/test_data.py                     # проверить коммитнутые данные
    python3 tests/test_data.py --file /tmp/x.js    # проверить копию (mutation control)

Файл читается как JS-обёртка: снимаем `window.MM_PROGRAM = ` и завершающую `;`,
дальше обычный `json.loads` — данные в файле и есть JSON.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data" / "program.js"
MARKER = "window.MM_PROGRAM = "
SOURCE = "https://lms.matemarketing.ru/api/event-program/event/6/"

TIME_RE = re.compile(r"^\d{2}:\d{2}$")
HTTPS_RE = re.compile(r"^https://\S+$")
ENTITY_RE = re.compile(r"&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);")

TOP_KEYS = {"source", "generatedAt", "event", "halls", "tracks", "days", "talks"}
EVENT_KEYS = {"id", "name", "startDate", "endDate"}
HALL_KEYS = {"id", "name", "order"}
TRACK_KEYS = {"id", "name", "description"}
# `order` не описан в CONTRACT.md §Данные, но его пишет генератор и он нужен
# сортировке дней; проверяем его как часть замороженной формы.
DAY_KEYS = {"id", "date", "name", "order", "halls"}
LECTOR_KEYS = {"name", "role", "photo"}
TALK_KEYS = {
    "id",
    "dayId",
    "hall",
    "track",
    "trackId",
    "title",
    "start",
    "end",
    "image",
    "lectors",
    "short",
    "description",
    "highlighted",
    "free",
    "broadcastType",
}

DAY_NAMES = ["1 день", "2 день", "Онлайн-день"]
DAY_DATES = ["2026-11-26", "2026-11-27", "2026-11-17"]
DAY_COUNTS = [39, 37, 15]
DAY1_HALLS = ["Молекула", "Атом", "Архангельск", "Физика", "Кинетика"]
ONLINE_HALLS = ["Онлайн-зал №1", "Онлайн-зал №2", "Онлайн-зал №3"]

COUNTER = {"n": 0}
DATA_PATH = DEFAULT_DATA


def bump(count: int = 1) -> None:
    """Считать проверенное утверждение (для итоговой строки)."""
    COUNTER["n"] += count


def load_program(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if MARKER not in text:
        raise SystemExit(f"{path}: нет обёртки {MARKER!r}")
    body = text.split(MARKER, 1)[1].strip()
    if body.endswith(";"):
        body = body[:-1]
    return json.loads(body)


def iter_strings(node: object) -> "list[str]":
    out: list[str] = []
    stack = [node]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            for key, value in item.items():
                out.append(key)
                stack.append(value)
        elif isinstance(item, list):
            stack.extend(item)
    return out


class ProgramDataTest(unittest.TestCase):
    data: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.data = load_program(DATA_PATH)
        cls.days = cls.data["days"]
        cls.talks = cls.data["talks"]
        cls.day_by_id = {day["id"]: day for day in cls.days}
        cls.track_ids = {track["id"] for track in cls.data["tracks"]}
        cls.hall_order = {hall["name"]: hall["order"] for hall in cls.data["halls"]}

    # --- объёмы и дни -----------------------------------------------------

    def test_00_volumes(self) -> None:
        self.assertEqual(len(self.days), 3, "дней должно быть 3")
        bump()
        self.assertEqual(len(self.talks), 91, "докладов должно быть 91")
        bump()
        self.assertEqual(len(self.data["tracks"]), 11, "треков должно быть 11")
        bump()
        self.assertEqual(len(self.data["halls"]), 9, "залов должно быть 9")
        bump()

    def test_01_day_identity(self) -> None:
        self.assertEqual([day["name"] for day in self.days], DAY_NAMES)
        bump()
        self.assertEqual([day["date"] for day in self.days], DAY_DATES)
        bump()
        for index, day in enumerate(self.days):
            with self.subTest(day=day["name"], index=index):
                self.assertRegex(day["date"], r"^\d{4}-\d{2}-\d{2}$")
                bump()

    def test_02_day_hall_order(self) -> None:
        self.assertEqual(self.days[0]["halls"], DAY1_HALLS, "порядок залов 1 дня")
        bump()
        self.assertEqual(self.days[1]["halls"], DAY1_HALLS, "порядок залов 2 дня")
        bump()
        self.assertEqual(self.days[2]["halls"], ONLINE_HALLS, "порядок онлайн-залов")
        bump()
        for day in self.days:
            with self.subTest(day=day["name"], kind="sorted+unique"):
                orders = [self.hall_order.get(name) for name in day["halls"]]
                self.assertNotIn(None, orders, "зал дня отсутствует в общем списке")
                self.assertEqual(len(day["halls"]), len(set(day["halls"])))
                self.assertEqual(orders, sorted(orders), "залы не по hall.order")
                bump(3)

    def test_03_day_counts(self) -> None:
        counts = [
            sum(1 for talk in self.talks if talk["dayId"] == day["id"])
            for day in self.days
        ]
        self.assertEqual(counts, DAY_COUNTS, "докладов по дням")
        bump()
        self.assertEqual(sum(counts), len(self.talks), "дни не покрывают все доклады")
        bump()

    # --- отдельный доклад -------------------------------------------------

    def test_04_talk_integrity(self) -> None:
        track_names = {track["id"]: track["name"] for track in self.data["tracks"]}
        for talk in self.talks:
            with self.subTest(talk=talk["id"]):
                self.assertIn(talk["dayId"], self.day_by_id, "dayId не из days")
                self.assertIn(
                    talk["hall"],
                    self.day_by_id.get(talk["dayId"], {}).get("halls", []),
                    "hall не в залах своего дня",
                )
                self.assertTrue(talk["title"].strip(), "пустой title")
                self.assertRegex(talk["start"], TIME_RE)
                self.assertRegex(talk["end"], TIME_RE)
                self.assertLess(talk["start"], talk["end"], "start не раньше end")
                bump(6)

        for talk in self.talks:
            with self.subTest(talk=talk["id"], field="track"):
                # Часть докладов приходит из API вообще без трека:
                # тогда track == "" и trackId is None. Иначе пара обязана
                # сходиться с tracks[] — и по id, и по имени.
                if talk["trackId"] is None:
                    self.assertEqual(talk["track"], "", "трек без id, но с именем")
                else:
                    self.assertIn(
                        talk["trackId"], self.track_ids, "trackId не из tracks"
                    )
                    self.assertEqual(
                        talk["track"],
                        track_names.get(talk["trackId"]),
                        "имя трека не совпадает с tracks[].name",
                    )
                bump(2)

        ids = [talk["id"] for talk in self.talks]
        self.assertEqual(len(ids), len(set(ids)), "id докладов не уникальны")
        bump()

    def test_05_media_and_lectors(self) -> None:
        for talk in self.talks:
            with self.subTest(talk=talk["id"], field="image"):
                if talk["image"] is not None:
                    self.assertRegex(talk["image"], HTTPS_RE, "image не https")
                bump()
            for lector in talk["lectors"]:
                with self.subTest(talk=talk["id"], lector=lector["name"][:24]):
                    self.assertTrue(lector["name"].strip(), "пустое имя лектора")
                    if lector["photo"] is not None:
                        self.assertRegex(lector["photo"], HTTPS_RE, "photo не https")
                    bump(2)

    # --- текст ------------------------------------------------------------

    def test_06_plain_text(self) -> None:
        for talk in self.talks:
            with self.subTest(talk=talk["id"], field="body"):
                for field in ("title", "short", "description"):
                    value = talk[field]
                    self.assertNotIn("<", value, f"{field}: HTML-тег")
                    self.assertNotIn(">", value, f"{field}: HTML-тег")
                    self.assertIsNone(
                        ENTITY_RE.search(value), f"{field}: HTML-сущность"
                    )
                    bump(3)
            for lector in talk["lectors"]:
                with self.subTest(talk=talk["id"], field="role"):
                    self.assertNotIn("<", lector["role"])
                    self.assertNotIn(">", lector["role"])
                    self.assertIsNone(ENTITY_RE.search(lector["role"]), "HTML-сущность")
                    bump(3)

        for track in self.data["tracks"]:
            with self.subTest(track=track["name"], field="description"):
                self.assertNotIn("<", track["description"])
                self.assertNotIn(">", track["description"])
                bump(2)

        for value in iter_strings(self.data):
            if value in {"undefined", "null", "NaN"}:
                with self.subTest(value=value):
                    self.fail("строка-артефакт в данных")
        bump()

    # --- схема ------------------------------------------------------------

    def test_07_schema_keys(self) -> None:
        self.assertEqual(set(self.data), TOP_KEYS)
        bump()
        self.assertEqual(set(self.data["event"]), EVENT_KEYS)
        bump()
        self.assertEqual(self.data["source"], SOURCE, "source не тот эндпоинт")
        bump()

        for hall in self.data["halls"]:
            with self.subTest(hall=hall["name"]):
                self.assertEqual(set(hall), HALL_KEYS)
                bump()
        for track in self.data["tracks"]:
            with self.subTest(track=track["name"]):
                self.assertEqual(set(track), TRACK_KEYS)
                bump()
        for day in self.days:
            with self.subTest(day=day["name"]):
                self.assertEqual(set(day), DAY_KEYS)
                bump()
        for talk in self.talks:
            with self.subTest(talk=talk["id"]):
                self.assertEqual(set(talk), TALK_KEYS)
                bump()
                for lector in talk["lectors"]:
                    self.assertEqual(set(lector), LECTOR_KEYS)
                    bump()

    # --- ветки рендера ----------------------------------------------------

    def test_08_edge_case_coverage(self) -> None:
        no_image = [talk["id"] for talk in self.talks if talk["image"] is None]
        multi = [talk["id"] for talk in self.talks if len(talk["lectors"]) > 1]
        no_lectors = [talk["id"] for talk in self.talks if not talk["lectors"]]
        empty_desc = [
            talk["id"] for talk in self.talks if not talk["description"].strip()
        ]

        self.assertGreaterEqual(len(no_image), 10, "мало докладов без баннера")
        bump()
        self.assertGreaterEqual(len(multi), 8, "мало докладов с 2+ лекторами")
        bump()
        self.assertGreaterEqual(len(no_lectors), 8, "мало докладов без лекторов")
        bump()
        self.assertGreaterEqual(
            len(empty_desc), 3, "мало докладов с пустым description"
        )
        bump()


def main() -> int:
    global DATA_PATH
    parser = argparse.ArgumentParser(description="Проверить контракт data/program.js.")
    parser.add_argument(
        "--file",
        type=Path,
        default=DEFAULT_DATA,
        help="путь к program.js (по умолчанию data/program.js)",
    )
    args = parser.parse_args()
    DATA_PATH = args.file

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ProgramDataTest)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    failed = len(result.failures) + len(result.errors)
    try:
        label = DATA_PATH.resolve().relative_to(ROOT)
    except ValueError:
        label = DATA_PATH
    print(
        f"{label}: {result.testsRun} тестов, {COUNTER['n']} проверок, {failed} провалов"
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
