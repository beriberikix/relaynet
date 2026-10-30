# web/docs

## Overview

The source of the public relaynet documentation and the script that renders it.
`docs.md` is the only file to edit. `build.py` turns it into the static files
served from `../public/`. It has no dependencies outside the Python standard
library (`html`, `pathlib`, `re`).

## Interface

- `docs.md`: the documentation source in Markdown.
- `build.py`: a script with no arguments, `python3 web/docs/build.py`. Paths are
  resolved from `__file__`, so it can be run from any working directory.
  - `HERE`, `OUT` (`../public`), `SOURCE` (the text of `docs.md`).
  - `slug(text)`: the heading anchor ids.
  - `inline(text)`: inline Markdown (code spans, `**bold**`, `[text](url)`) to
    HTML, with escaping.
  - `render(md)`: returns `(body_html, toc)`. It handles `#`-`###` headings,
    paragraphs, `- ` and `N. ` lists, pipe tables, and fenced code blocks.
  - `TEMPLATE`: the HTML page. `str.format` fills its `{toc}` and `{body}`.
    Its footer always links relaynet.network's Terms, Acceptable use, Privacy,
    status page and support address; unlike `index.html`, it is not gated on
    `hostedService`, so self-hosted copies of `docs.html` carry them too.
  - `LLMS`: the content of `llms.txt`, a hardcoded string that is not derived
    from `docs.md`.
- Outputs (in `../public/`):

| Output | Built from |
|---|---|
| `docs.html` | `TEMPLATE` filled with `render(SOURCE)` |
| `docs.md` | A verbatim copy of `docs.md` |
| `llms.txt` | The `LLMS` constant |

## Invariants

- The generated files in `../public/` must never be edited by hand. Edit
  `docs.md` (or `LLMS` in `build.py` for `llms.txt`) and rerun the script.
  `TEMPLATE` states this in the generated page.
- Output is deterministic: no timestamps, randomness, or environment lookups.
  CI depends on this to detect stale output.
- Only heading levels 1-3 are recognized. The H1 gets no `id` and is not in the
  table of contents. H2 and H3 get `id=slug(text)` and a self-link. Duplicate
  slugs are not deduplicated.
- Text is HTML-escaped (`quote=False`) before the bold and link substitutions,
  and code spans and fences are escaped. Link URLs get no further escaping.
- `TEMPLATE` goes through `str.format`, so any literal `{` or `}` added to it
  must be doubled.

## Side Effects

- Reads `docs.md`.
- Overwrites `../public/docs.html`, `../public/docs.md`, and
  `../public/llms.txt`, and prints `wrote <path>` for each one.
- No network access and no subprocesses.

## Verification

- Run (from the repository root, as CI's `web` job does in
  `.github/workflows/ci.yml`):

```sh
python3 web/docs/build.py && git diff --exit-code -- web/public
```
