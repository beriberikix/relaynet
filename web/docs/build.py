#!/usr/bin/env python3
"""Build the public docs from docs.md (the single source).

Writes web/public/docs.html (the page, with a contents sidebar),
web/public/docs.md (the Markdown as is, for agents and copy-paste) and
web/public/llms.txt (an index for AI agents, https://llmstxt.org).

Handles the Markdown subset docs.md uses: #/##/### headings, paragraphs,
"- " and "1. " lists (with indented continuation lines), pipe tables, fenced
code blocks, [links](url), **bold** and `code`.

    python3 web/docs/build.py
"""

import html
import pathlib
import re

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "public"
SOURCE = (HERE / "docs.md").read_text()


def slug(text):
    text = re.sub(r"[`*]", "", text).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            out.append(f"<code>{html.escape(part[1:-1], quote=False)}</code>")
            continue
        part = html.escape(part, quote=False)
        part = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", part)
        part = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', part)
        out.append(part)
    return "".join(out)


def render(md):
    out, toc = [], []
    para, items, rows, code = [], [], [], None
    list_kind, list_start = None, 1

    def flush():
        nonlocal para, items, rows, list_kind
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
        if items:
            tag = "ol" if list_kind == "ol" else "ul"
            start = f' start="{list_start}"' if tag == "ol" and list_start != 1 else ""
            out.append(f"<{tag}{start}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{tag}>")
        if rows:
            head, body = rows[0], rows[2:]
            thead = ""
            if any(c for c in head):
                thead = "<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>"
            out.append('<div class="table-wrap"><table class="doc-table">' + thead + "<tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
                       + "</tbody></table></div>")
        para, items, rows, list_kind = [], [], [], None

    for line in md.splitlines():
        stripped = line.strip()
        if code is not None:
            if stripped.startswith("```"):
                lang, lines = code
                cls = f' class="language-{lang}"' if lang else ""
                out.append(f"<pre><code{cls}>{html.escape(chr(10).join(lines), quote=False)}</code></pre>")
                code = None
            else:
                code[1].append(line)
            continue
        if stripped.startswith("```"):
            flush()
            code = (stripped[3:].strip(), [])
            continue
        if not stripped:
            if not items:
                flush()
            continue
        heading = re.match(r"^(#{1,3}) (.*)", stripped)
        if heading:
            flush()
            level, text = len(heading.group(1)), heading.group(2)
            if level == 1:
                out.append(f"<h1>{inline(text)}</h1>")
            else:
                anchor = slug(text)
                toc.append((level, anchor, text))
                out.append(f'<h{level} id="{anchor}"><a class="anchor" href="#{anchor}">{inline(text)}</a></h{level}>')
            continue
        if stripped.startswith("|"):
            if para or items:
                flush()
            rows.append([c.strip() for c in stripped.strip("|").split("|")])
            continue
        bullet = re.match(r"^- (.*)", stripped)
        number = re.match(r"^(\d+)\. (.*)", stripped)
        if bullet or number:
            kind = "ul" if bullet else "ol"
            if para or rows or (items and list_kind != kind):
                flush()
            if not items:
                list_kind = kind
                list_start = int(number.group(1)) if number else 1
            items.append((bullet or number).group(bullet and 1 or 2))
            continue
        if items and line.startswith("  "):
            items[-1] += " " + stripped
            continue
        if items:
            flush()
        para.append(stripped)
    flush()
    return "\n".join(out), toc


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Docs · relaynet</title>
  <meta name="description" content="How to use relaynet: use cases and alternatives, API tokens, the relay.v1 WebSocket protocol, the virtual network, limits and errors.">
  <link rel="alternate" type="text/markdown" href="/docs.md" title="This page as Markdown">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%232563eb'/%3E%3Ccircle cx='16' cy='16' r='5' fill='white'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Generated from web/docs/docs.md by web/docs/build.py; edit the Markdown. -->
  <header class="topbar">
    <a class="brand" href="/"><span class="brand-dot" aria-hidden="true"></span> relaynet</a>
    <nav class="topnav"><a href="/">Home</a><a href="/docs.md">Markdown</a></nav>
  </header>
  <main class="docs">
    <nav class="docs-toc" aria-label="Contents">
      <p class="docs-toc-title">Contents</p>
      <ul>
{toc}
      </ul>
    </nav>
    <article class="docs-body">
{body}
    </article>
  </main>
  <footer class="footer">
    <span><a href="terms.html">Terms</a> · <a href="acceptable-use.html">Acceptable use</a> · <a href="privacy.html">Privacy</a> · <a href="https://status.relaynet.network" rel="noopener">Status</a></span>
    <span>Contact: <a href="mailto:support@relaynet.network">support@relaynet.network</a></span>
  </footer>
</body>
</html>
"""

LLMS = """# relaynet

> relaynet is a hosted relay that gives web pages and other programs raw IPv4
> networking: a client with its own TCP/IP stack (a browser VM, or a
> user-space stack such as lwIP or smoltcp) sends Ethernet frames over a
> WebSocket (subprotocol `relay.v1`, endpoint `wss://relay.relaynet.network/`);
> the relay answers DHCP and ARP and forwards TCP and UDP to the internet.
> Used for browser VMs, SSH clients, USB/IP, debug protocols, KVM consoles and
> custom or peer-to-peer protocols. Access needs an API token (invite-only beta).

Key facts: each binary WebSocket message is one Ethernet II frame (no FCS);
the token goes in the subprotocol list as `relay.token.<token>` (browsers)
or as `Authorization: Bearer <token>`; network `10.0.2.0/24`, gateway
`10.0.2.2` (MAC `52:54:00:12:34:56`), DNS `8.8.8.8`, MTU 1500; private
ranges and port 25 are blocked; sessions of one account share a private
network; no inbound ports. Not a fit when the user controls the server (use a
WebSocket or WebTransport), needs browser-to-browser media (WebRTC) or only
calls HTTP APIs (fetch). Check a token with
`GET https://relay.relaynet.network/api/me`.

## Docs

- [Full documentation (Markdown)](https://relaynet.network/docs.md): use cases and alternatives, quick start, connecting from browsers, v86 and Node, API tokens, the relay.v1 protocol, virtual network, DHCP, outbound rules, errors and close codes, limits, account API, troubleshooting
- [Full documentation (HTML)](https://relaynet.network/docs)

## Policies

- [Terms of Service](https://relaynet.network/terms)
- [Acceptable Use Policy](https://relaynet.network/acceptable-use)
- [Privacy Policy](https://relaynet.network/privacy)
- [Service status](https://status.relaynet.network)
"""

body, toc = render(SOURCE)
toc_html = "\n".join(
    f'        <li class="toc-{level}"><a href="#{anchor}">{inline(text)}</a></li>' for level, anchor, text in toc
)
(OUT / "docs.html").write_text(TEMPLATE.format(body=body, toc=toc_html))
(OUT / "docs.md").write_text(SOURCE)
(OUT / "llms.txt").write_text(LLMS)
for name in ("docs.html", "docs.md", "llms.txt"):
    print("wrote", OUT / name)
