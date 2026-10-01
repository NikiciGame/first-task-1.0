# Review Duplicate Inspector

A small static prototype for flagging possible duplicate translated clinic reviews before publication. It does not delete anything: a moderator decides **Duplicate**, **Distinct**, or **Unsure**.

## Architecture

`app.js` is source-agnostic: it accepts normalized review records and runs an explainable O(n²) checker in the browser. `scripts/fetch_reviews.py` is only a public-web demo adapter. It decodes the observed Next.js review payload at the public GBG page, normalizes it, and writes `data/reviews.json`.

Refresh the committed snapshot with:

```bash
python3 scripts/fetch_reviews.py
python3 -m http.server 8000
```

Then open `http://localhost:8000`. The scraper uses only Python's standard library and fails clearly if the observed hydration payload or fields change.

## Scoring

The checker uses corpus TF-IDF cosine similarity for translated (or original) text, then blends same normalized clinic, same/near date, source, rating, and procedure when supplied. Missing metadata is excluded and the remaining weights are renormalized. The thresholds and weights near the top of `app.js` are prototype heuristics meant to be calibrated against moderator decisions.

In production, call the same checker around ingestion/database insertion. Prefer source-native IDs and original-language text first; add candidate retrieval/embeddings if volume grows, and reserve an LLM for adjudicating ambiguous candidates—not every review.
