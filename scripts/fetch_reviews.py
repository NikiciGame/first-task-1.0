#!/usr/bin/env python3
"""Fetch the public GBG review page and save a normalized demo snapshot.

This is deliberately an adapter: the browser app's duplicate checker knows
nothing about Next.js, HTML, or Gangnam Beauty Guide's public website.
"""
from __future__ import annotations

import html.parser
import json
import sys
import urllib.request
from pathlib import Path

URL = "https://gangnambeautyguide.com/en/reviews/"
OUT = Path(__file__).resolve().parents[1] / "data" / "reviews.json"


class Scripts(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts: list[str] = []
        self.in_script = False
        self.current: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.in_script, self.current = True, []

    def handle_data(self, data):
        if self.in_script:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.in_script:
            self.scripts.append("".join(self.current))
            self.in_script = False


def embedded_reviews(page: str) -> list[dict]:
    """Extract the review list from the currently observed Next.js payload."""
    parser = Scripts()
    parser.feed(page)
    for script in parser.scripts:
        marker = "self.__next_f.push([1,"
        if marker not in script:
            continue
        try:
            # The push argument is valid JSON: [1, "decoded RSC payload"].
            payload = json.loads(script[script.index("[1,") : script.rfind(")")])
            rsc = payload[1]
            if '"reviews":' not in rsc:
                continue
            start = rsc.index('"reviews":') + len('"reviews":')
            reviews, _ = json.JSONDecoder().raw_decode(rsc[start:])
        except (ValueError, json.JSONDecodeError, IndexError) as exc:
            raise RuntimeError("Found the GBG hydration payload but could not decode reviews.") from exc
        # Other RSC fragments contain a localized `reviews: "Reviews"` label.
        # The card payload is the only list-shaped value.
        if not isinstance(reviews, list) or not reviews:
            continue
        required = {"clinicName", "source", "date", "rating", "summary"}
        if not required.issubset(reviews[0]):
            raise RuntimeError(f"GBG review shape changed; expected fields {sorted(required)}.")
        return reviews
    raise RuntimeError("GBG page structure changed: no review hydration payload was found.")


def normalize(raw: list[dict]) -> list[dict]:
    return [
        {
            "id": f"gbg-public-{i + 1:03d}",
            "clinic": item["clinicName"],
            "source": item["source"],
            "date": item["date"],
            "rating": item["rating"],
            "procedure": None,
            "original_text": None,
            "translated_text": item["summary"],
        }
        for i, item in enumerate(raw)
    ]


def main() -> None:
    request = urllib.request.Request(URL, headers={"User-Agent": "Review-Duplicate-Inspector/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            page = response.read().decode("utf-8")
    except Exception as exc:
        raise SystemExit(f"Could not fetch {URL}: {exc}") from exc
    reviews = normalize(embedded_reviews(page))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(reviews, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(reviews)} reviews to {OUT}")


if __name__ == "__main__":
    main()
