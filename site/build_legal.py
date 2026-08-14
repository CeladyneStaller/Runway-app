# ── The two legal pages, generated from the executed documents ───────────────────────────────────
#
# ⚠️ THE MARKDOWN IN `../../rw/src/legal/` IS THE SOURCE, and it is the same file the app's modal
# renders. Two hand-maintained copies is how a site says one thing and an app says another — and the
# difference only surfaces when somebody quotes the wrong one back at you.
#
# ⚠️ THE PLACEHOLDERS THESE REPLACE WERE 5KB FOR A 39KB DOCUMENT. A page headed "Terms." with a
# paragraph under it is worse than no page: procurement finds it, reads it, and concludes there are no
# real terms.

import re, sys, html, os
sys.path.insert(0, ".")
from _parts import page

SRC = "/home/claude/rw/src/legal"
VERSION, EFFECTIVE = "2026-08-12", "12 August 2026"

WARN = {
  "terms": ["Section 13 contains a jury waiver and a class action waiver.",
            "Section 11 limits our liability.",
            "Section 6 explains that Waterline is a modelling tool, not an adviser."],
  "privacy": ["We do not sell or rent personal information and we never have.",
              "We do not use your data to train machine learning or AI models."],
}

def render(md):
    """Markdown to the site's own markup. Sections get ids so the contents list can reach them."""
    out, toc = [], []
    for raw in md.split("\n"):
        l = raw.strip()
        if not l:
            continue
        if l.startswith("## "):
            t = l[3:]
            m = re.match(r"^(\d+)\.\s*(.*)$", t)
            sid = f"s{m.group(1)}" if m else re.sub(r"\W+", "-", t.lower())[:24]
            toc.append((sid, m.group(1) if m else "", m.group(2) if m else t))
            out.append(f'<h2 id="{sid}">{html.escape(t)}</h2>')
        elif l.startswith("### "):
            out.append(f"<h3>{html.escape(l[4:])}</h3>")
        elif l.startswith("# "):
            continue
        else:
            # ⚠️ ALL-CAPS PARAGRAPHS KEEP THEIR CAPITALS AND GET A CLASS. Several disclaimers are only
            # enforceable if they are CONSPICUOUS — a page that sentence-cases them for tidiness is
            # quietly weakening the clause it is displaying.
            cls = ' class="caps"' if l == l.upper() and len(l) > 40 else ""
            out.append(f"<p{cls}>{html.escape(l)}</p>")
    return "\n".join(out), toc

def build(doc, title, desc):
    md = open(f"{SRC}/{doc}.md").read()
    body_html, toc = render(md)
    warn = "\n".join(f"<p>{html.escape(w)}</p>" for w in WARN[doc])
    nav = "\n".join(
        f'<a href="#{sid}">{n + " · " if n else ""}{html.escape(t)}</a>' for sid, n, t in toc)
    other = ("privacy", "Privacy Policy") if doc == "terms" else ("terms", "Terms of Service")
    body = f"""
<section class="wrap legal">
  <nav class="legal-toc" aria-label="Contents">{nav}</nav>
  <article class="legal-doc">
    <p class="eyebrow">Legal</p>
    <h1>{title}</h1>
    <p class="legal-meta">Version {VERSION} · Effective {EFFECTIVE} · Waterline Technology Co.</p>
    <div class="legal-warn">{warn}</div>
    {body_html}
    <div class="legal-foot">
      <p class="fine">Superseded versions are kept and dated. This page is the version currently in
        force; an acceptance recorded against an earlier version points at that version, which stays
        reachable.</p>
      <p class="fine"><a href="/{other[0]}/">Read the {other[1]}</a> ·
        <a href="mailto:info@waterline-runway.com">Ask us a question</a></p>
    </div>
  </article>
</section>
"""
    return page(f"{doc}/index.html", title, desc, "", body)

def archive(doc, title, desc):
    """⚠️ THE VERSION IN FORCE IS WRITTEN TWICE: once at `/terms/`, once at `/terms/<version>/`.

    An acceptance record naming 2026-08-12 points at a document that has to STILL EXIST. Overwriting
    `/terms/` on the next revision leaves every prior acceptance pointing at text that no longer says
    what it said — **the record becomes evidence of nothing.**

    Writing the dated copy on EVERY build, rather than when a version is superseded, is deliberate: a
    step you only take at supersession is a step you forget at supersession, which is the one moment it
    matters. The dated copy is written before the text ever changes, so it is already there.
    """
    import shutil
    out = f"{doc}/{VERSION}/index.html"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copyfile(f"{doc}/index.html", out)
    return out


def check_archive(doc):
    """⚠️ A DATED COPY THAT DIFFERS FROM ITS OWN VERSION IS THE FAILURE THIS GUARDS AGAINST.

    If `terms/2026-08-12/` exists and does not match what we just generated for 2026-08-12, then the
    markdown changed without the version being bumped — so somebody's acceptance of "2026-08-12" now
    names two different documents. **Refuse to build rather than overwrite the archived one.**
    """
    out = f"{doc}/{VERSION}/index.html"
    if not os.path.exists(out):
        return None
    if open(out).read() != open(f"{doc}/index.html").read():
        return (f"{doc}: the text changed but VERSION is still {VERSION}. "
                f"Bump VERSION (and LEGAL_VERSION in src/legal/index.js), or restore the text. "
                f"The archived {VERSION} was NOT overwritten.")
    return None


if __name__ == "__main__":
    for d, t, s in [("terms", "Terms of Service",
                     "The agreement between you and Waterline Technology Co."),
                    ("privacy", "Privacy Policy",
                     "What Waterline holds, why, and what we never do with it.")]:
        build(d, t, s)
        stale = check_archive(d)
        if stale:
            # RESTORE THE ARCHIVED COPY over the one just generated, so a refused build leaves the
            # published page matching its own version rather than half-updated.
            import shutil
            shutil.copyfile(f"{d}/{VERSION}/index.html", f"{d}/index.html")
            print("REFUSED  " + stale)
            raise SystemExit(1)
        p = f"{d}/index.html"
        a = archive(d, t, s)
        print(f"{p:24} {os.path.getsize(p):>7,} bytes   archived -> {a}")
