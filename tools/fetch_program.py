"""Normalize the raw event-program API payload into data/program.js.

Modes (mutually exclusive):

    python3 tools/fetch_program.py             # rebuild data/program.js from data/program.raw.json
    python3 tools/fetch_program.py --dry-run   # normalize in memory, print counts, write nothing
    python3 tools/fetch_program.py --check     # render in memory and diff against the committed file
    python3 tools/fetch_program.py --fetch     # download the API payload, then rebuild

The API is a public Django REST endpoint (no auth). Importing this module never
writes anything: every side effect lives behind ``main()``.
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "program.raw.json"
OUT = ROOT / "data" / "program.js"
SOURCE = "https://lms.matemarketing.ru/api/event-program/event/6/"
#: Отдельно от SOURCE: SOURCE уезжает в payload как поле `source`, а этот адрес
#: только качается (в тестах подменяется на file:// без порчи данных).
FETCH_URL = SOURCE
USER_AGENT = "mm-program-page/1.0"
TIMEOUT = 30

HEADER = "/* Сгенерировано tools/fetch_program.py — не править вручную. */\n"
JS_PREFIX = "window.MM_PROGRAM = "
JS_SUFFIX = ";\n"

#: Строка, которая меняется при каждом запуске и потому игнорируется в --check.
VOLATILE_RE = re.compile(r'^\s*"generatedAt"\s*:.*$', re.MULTILINE)


def hhmm(value: str | None) -> str:
    return (value or "")[:5]


def name_of(lector: dict) -> str:
    parts = [
        lector.get("first_name"),
        lector.get("middle_name"),
        lector.get("last_name"),
    ]
    return " ".join(p.strip() for p in parts if p and p.strip())


def plain(text: str | None) -> str:
    """HTML → плоский текст: блочные теги в перевод строки, сущности раскрыты."""
    text = text or ""
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|h[1-6])>", "\n\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "— ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    blocks = [" ".join(b.split()) for b in re.split(r"\n\s*\n|\n", text)]
    return "\n\n".join(b for b in blocks if b)


def one_line(text: str | None) -> str:
    return " ".join(plain(text).split())


def first_paragraph(text: str) -> str:
    for block in (text or "").split("\n\n"):
        block = plain(block)
        if block:
            return block
    return ""


def normalize(raw: dict) -> dict:
    """Сырой payload API → объект контракта `window.MM_PROGRAM`."""
    halls = sorted(
        (
            {"id": h["id"], "name": h["name"], "order": h.get("order") or 0}
            for h in raw.get("halls", [])
        ),
        key=lambda h: (h["order"], h["id"]),
    )
    hall_order = {h["name"]: h["order"] for h in halls}

    tracks = [
        {
            "id": t["id"],
            "name": t["name"],
            "description": one_line(t.get("description")),
        }
        for t in raw.get("tracks", [])
    ]

    days = []
    talks = []
    for day in raw.get("days", []):
        day_halls = sorted(
            {t["hall"]["name"] for t in day.get("talks", []) if t.get("hall")},
            key=lambda n: (hall_order.get(n, 999), n),
        )
        days.append(
            {
                "id": day["id"],
                "date": day["date"],
                "name": day["name"],
                "order": day.get("order") or 0,
                "halls": day_halls,
            }
        )
        for talk in day.get("talks", []):
            short = one_line(talk.get("short_description"))
            description = plain(talk.get("description"))
            if not short:
                short = first_paragraph(description)
            track = talk.get("track") or {}
            talks.append(
                {
                    "id": talk["id"],
                    "dayId": day["id"],
                    "hall": (talk.get("hall") or {}).get("name") or "",
                    "track": track.get("name") or "",
                    "trackId": track.get("id"),
                    "title": one_line(talk.get("name")),
                    "start": hhmm(talk.get("start_time")),
                    "end": hhmm(talk.get("end_time")),
                    "image": talk.get("image_url") or talk.get("image") or None,
                    "lectors": [
                        {
                            "name": name_of(l),
                            "role": one_line(l.get("description")),
                            "photo": l.get("photo"),
                        }
                        for l in talk.get("lectors", [])
                        if name_of(l)
                    ],
                    "short": short,
                    "description": description,
                    "highlighted": bool(talk.get("is_highlighted")),
                    "free": bool(talk.get("free")),
                    "broadcastType": talk.get("broadcast_type") or "",
                }
            )

    days.sort(key=lambda d: (d["order"], d["date"]))
    talks.sort(key=lambda t: (t["start"], t["hall"], t["id"]))

    return {
        "source": SOURCE,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event": {
            "id": raw.get("event"),
            "name": raw.get("event_name"),
            "startDate": min(d["date"] for d in days) if days else None,
            "endDate": max(d["date"] for d in days) if days else None,
        },
        "halls": halls,
        "tracks": tracks,
        "days": days,
        "talks": talks,
    }


def render(payload: dict) -> str:
    """Payload → полный текст data/program.js (стабильный формат, indent=1)."""
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    return f"{HEADER}{JS_PREFIX}{body}{JS_SUFFIX}"


def summary(payload: dict) -> str:
    return (
        f"{len(payload['days'])} дней, {len(payload['talks'])} докладов, "
        f"{len(payload['tracks'])} треков, {len(payload['halls'])} залов"
    )


def compare(expected: str, actual: str | None) -> list[str]:
    """Сравнить рендер с коммитнутым файлом, игнорируя generatedAt и пробелы."""
    if actual is None:
        return ["<committed file is missing>"]
    left = VOLATILE_RE.sub('"generatedAt": "",', expected)
    right = VOLATILE_RE.sub('"generatedAt": "",', actual)
    if re.sub(r"\s+", "", left) == re.sub(r"\s+", "", right):
        return []
    diff = difflib.unified_diff(
        right.splitlines(),
        left.splitlines(),
        fromfile=f"{OUT.relative_to(ROOT)} (committed)",
        tofile=f"{OUT.relative_to(ROOT)} (rebuilt)",
        lineterm="",
        n=1,
    )
    lines = list(diff)
    head, body = lines[:3], lines[3:]  # --- / +++ / @@ остаются, тело режем до 40
    return head + body[:40]


def load_raw(path: Path = RAW) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_atomic(path: Path, text: str) -> None:
    """Писать через соседний .tmp, чтобы сбой не оставил полуфайл."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def download(timeout: int = TIMEOUT) -> str:
    """Скачать тело ответа API как текст. Сетевые ошибки — исключением наверх."""
    request = urllib.request.Request(
        FETCH_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset)


def parse_raw(body: str) -> dict:
    """Проверить, что тело — payload ожидаемой формы."""
    data = json.loads(body)
    if not isinstance(data, dict) or not data.get("days"):
        raise ValueError("payload has no `days` — endpoint shape changed")
    return data


def fail(message: str) -> int:
    print(f"fetch_program: {message}", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Пересобрать data/program.js из payload API.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--fetch",
        action="store_true",
        help=f"скачать {FETCH_URL} в data/program.raw.json, затем пересобрать",
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help="сравнить пересборку с коммитнутым data/program.js, exit 1 при расхождении",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="нормализовать в памяти и напечатать счётчики, ничего не записывая",
    )
    args = parser.parse_args(argv)

    raw_body: str | None = None
    if args.fetch:
        try:
            raw_body = download()
            raw = parse_raw(raw_body)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return fail(f"не удалось скачать {FETCH_URL}: {exc}")
        except (json.JSONDecodeError, ValueError) as exc:
            return fail(f"ответ {FETCH_URL} не разобрался как JSON: {exc}")
    else:
        try:
            raw = load_raw()
        except FileNotFoundError:
            return fail(
                f"нет входного файла {RAW.relative_to(ROOT)} — запусти с --fetch"
            )
        except json.JSONDecodeError as exc:
            return fail(f"{RAW.relative_to(ROOT)} — битый JSON: {exc}")

    payload = normalize(raw)
    text = render(payload)

    if args.check:
        try:
            committed: str | None = OUT.read_text(encoding="utf-8")
        except FileNotFoundError:
            committed = None
        diff = compare(text, committed)
        if not diff:
            print(
                f"OK: {OUT.relative_to(ROOT)} совпадает с payload ({summary(payload)})"
            )
            return 0
        print("\n".join(diff))
        return fail(f"{OUT.relative_to(ROOT)} расходится с data/program.raw.json")

    if args.dry_run:
        print(f"dry-run: {summary(payload)}")
        return 0

    if raw_body is not None:
        write_atomic(RAW, raw_body)
    write_atomic(OUT, text)
    print(f"{OUT.relative_to(ROOT)}: {summary(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
