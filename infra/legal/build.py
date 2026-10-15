#!/usr/bin/env python3
"""Render the legal Markdown in this directory to web/public/*.html.

Handles the small subset the documents use: #/## headings, paragraphs,
"- " lists, pipe tables, [links](url), **bold**, _italic_ and `code`.
"""

import html
import pathlib
import re

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent.parent / "web" / "public"
PAGES = {
    "terms.md": ("terms.html", "Terms of Service"),
    "acceptable-use.md": ("acceptable-use.html", "Acceptable Use Policy"),
    "privacy.md": ("privacy.html", "Privacy Policy"),
}
LINKS = {"acceptable-use": "acceptable-use.html", "privacy": "privacy.html", "terms": "terms.html"}


def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w/])_([^_]+)_(?!\w)", r"<em>\1</em>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: f'<a href="{LINKS.get(m.group(2), m.group(2))}">{m.group(1)}</a>', text)
    text = re.sub(r"\b([a-z]+@relaynet\.network)\b", r'<a href="mailto:\1">\1</a>', text)
    return text


def render(md):
    out, para, items, rows = [], [], [], []

    def flush():
        nonlocal para, items, rows
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
        if items:
            out.append("<ul>" + "".join(f"<li>{inline(i)}</li>" for i in items) + "</ul>")
        if rows:
            head, body = rows[0], [r for r in rows[2:]]
            out.append('<table class="table">'
                       + "<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>"
                       + "<tbody>" + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table>")
        para, items, rows = [], [], []

    for line in md.splitlines():
        stripped = line.strip()
        if not stripped:
            flush()
        elif stripped.startswith("|"):
            if para or items:
                flush()
            rows.append([c.strip() for c in stripped.strip("|").split("|")])
        elif stripped.startswith("## "):
            flush()
            out.append(f"<h2>{inline(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            flush()
            out.append(f"<h1>{inline(stripped[2:])}</h1>")
        elif stripped.startswith("- "):
            if para:
                flush()
            items.append(stripped[2:])
        elif items and line.startswith("  "):
            items[-1] += " " + stripped
        else:
            para.append(stripped)
    flush()
    return "\n".join(out)


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} · relaynet</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%232563eb'/%3E%3Ccircle cx='16' cy='16' r='5' fill='white'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><span class="brand-dot" aria-hidden="true"></span> relaynet</a>
    <nav class="topnav"><a href="/">Home</a></nav>
  </header>
  <main class="legal">
{body}
  </main>
  <footer class="footer">
    <span><a href="terms.html">Terms</a> · <a href="acceptable-use.html">Acceptable use</a> · <a href="privacy.html">Privacy</a></span>
    <span>Contact: <a href="mailto:support@relaynet.network">support@relaynet.network</a></span>
  </footer>
</body>
</html>
"""

for src, (dst, title) in PAGES.items():
    body = render((HERE / src).read_text())
    (OUT / dst).write_text(TEMPLATE.format(title=title, body=body))
    print("wrote", OUT / dst)
