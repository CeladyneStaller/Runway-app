# The shell every page shares. Written once here, rendered into each page — a static site with fifteen
# copies of a hand-edited nav is a site whose nav is wrong on three of them.

NAV = [("/product/", "Product"), ("/advisors/", "Advisors"), ("/pricing/", "Pricing"),
       ("/docs/", "Docs"), ("/writing/", "Writing")]

APP = "https://runway-app-two.vercel.app"

def head(title, desc, current=""):
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
<link rel="icon" href="/favicon.svg">
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
          <li><a href="mailto:hello@waterline.app">hello@waterline.app</a></li>
        </ul>
      </div>
    </div>
    <p class="foot__base">© 2026 Waterline · Cash runway modelling for grant-funded organizations</p>
  </div>
</footer>
</body>
</html>
'''

def page(path, title, desc, current, body):
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "w").write(head(title, desc, current) + body + FOOT)
    return path
