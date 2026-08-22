# The shell every page shares. Written once here, rendered into each page — a static site with fifteen
# copies of a hand-edited nav is a site whose nav is wrong on three of them.

NAV = [("/product/", "Product"), ("/advisors/", "Advisors"), ("/pricing/", "Pricing"),
       ("/docs/", "Docs"), ("/writing/", "Writing")]

SITE = "https://waterline-runway.com"
EMAIL = "info@waterline-runway.com"

# The site and the app subdomain go live together. Until the DNS record answers, every "Open the app"
# button here 404s — which is correct, because the site is not public until then either.
APP = "https://app.waterline-runway.com"

def head(title, desc, current="", path=None):
    """⚠️ `current` HIGHLIGHTS A NAV ITEM. `path` IS THIS PAGE'S OWN URL. They are not the same job, and
    for a long time one variable did both.

    A sub-page passes `current="/product/"` so the Product tab lights up — and that value was ALSO used
    for the canonical and `og:url`. So `/product/payroll/`, `/product/scenarios/` and
    `/product/funded-work/` each told Google "the real version of this page is /product/", and the legal
    pages pointed at the homepage. **A canonical to a different URL is a request to be dropped from the
    index**, so four content pages and both legal pages were asking not to be found. Funded work is the
    strongest page on the site and the one nobody else can write; it was invisible.

    They coincide on top-level pages, which is exactly why it survived: every page where the two jobs
    differ is a page nobody checked.

    `path` defaults to `current` so existing callers keep working; sub-pages pass their own.
    """
    SITE_ = SITE  # for the f-string below
    here = path if path is not None else current
    links = "".join(
        f'<a href="{h}"{" aria-current=\"page\"" if h == current else ""}>{t}</a>'
        for h, t in NAV)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{SITE_}{here or '/'}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Waterline">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE_}{here or '/'}">
<meta property="og:image" content="{SITE_}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Spectral:ital,wght@0,200;0,300;0,400;1,300&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shared.css">
</head>
<body>
<header class="nav">
  <div class="wrap nav__in">
    <a class="nav__logo" href="/">
      <svg viewBox="0 0 1024 1024" aria-hidden="true"><use href="/mark.svg#duck"/></svg>
      <span>Waterline</span>
    </a>
    <nav class="nav__links">{links}</nav>
    <a class="btn btn--fill" href="{APP}">Open the app</a>
  </div>
</header>
'''

FOOT = f'''<footer class="foot">
  <div class="wrap">
    <div class="foot__cols">
      <div>
        <a class="foot__logo" href="/">Waterline</a>
        <p class="foot__blurb">Cash runway modelling for grant-funded organizations.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="/product/grants/">Grants</a></li>
          <li><a href="/product/commitments/">Commitments</a></li>
          <li><a href="/product/scenarios/">Scenarios</a></li>
          <li><a href="/advisors/">For advisors</a></li>
        </ul>
      </div>
      <div>
        <h4>Learn</h4>
        <ul>
          <li><a href="/docs/">Docs</a></li>
          <li><a href="/writing/">Writing</a></li>
          <li><a href="/pricing/">Pricing</a></li>
        </ul>
      </div>
      <div>
        <h4>Trust</h4>
        <ul>
          <li><a href="/security/">Security</a></li>
          <li><a href="/privacy/">Privacy</a></li>
          <li><a href="/terms/">Terms</a></li>
          <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
        </ul>
      </div>
    </div>
    <p class="foot__base">© 2026 Waterline · Cash runway modelling for grant-funded organizations</p>
  </div>
</footer>
</body>
</html>
'''

def page(path, title, desc, current, body, url=None):
    """⚠️ THE PAGE'S OWN URL IS DERIVED FROM WHERE IT IS WRITTEN, not from the nav item it highlights.
    `product/payroll/index.html` -> `/product/payroll/`. Passing `current` for both is what pointed six
    canonicals at the wrong page; deriving it means a new sub-page cannot repeat the mistake by
    forgetting an argument."""
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    derived = "/" + path[:-len("index.html")].lstrip("./") if path.endswith("index.html") else "/" + path.lstrip("./")
    open(path, "w").write(head(title, desc, current, url or derived) + body + FOOT)
    return path
