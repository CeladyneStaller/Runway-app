# Waterline — website

Static HTML. No build step, no framework, no dependencies. Drop the folder on Vercel, Netlify or
anything that serves files.

## Structure

    /                        home
    /product/                overview
    /product/grants/         the page nobody else can write
    /product/commitments/    signed vs spent, covered runway
    /product/scenarios/      the three confidence layers
    /advisors/               its own page, its own pricing
    /pricing/                the app's real figures, plus the FAQ
    /security/               the page that unblocks the first real customer
    /privacy/  /terms/       plain-language drafts, NOT lawyer-reviewed
    /docs/                   help, written as questions arrive
    /docs/quickbooks/        what is read, and what unpaid bills miss
    /writing/                six named pieces, one written
    /writing/reimbursement-lag/

    shared.css               one stylesheet
    mark.svg                 the duck, defined once, referenced by <use>
    _parts.py                the shell — regenerate pages after editing

## Prices come from the app

Solo $40 · Collaborative $99 · Connected $149 · Advisor $99 · Advisor Unlimited $199 · 14-day trial.
Taken from `src/state/plans.js`. **If those change, this site is wrong** — there is no import, and a
site that contradicts checkout costs more than one that is out of date.

## Before it goes live

1. **Backups.** `/security/` says explicitly that retention is not yet described. Ship the backups,
   then replace that paragraph. Do not describe a policy that does not exist.
2. **Legal review** of `/privacy/` and `/terms/`. Both carry a visible notice saying they are drafts;
   remove it when reviewed.
3. **A real inbox** at hello@waterline-runway.com. The address appears on nine pages.
4. **The five unwritten articles.** They are listed as "Coming" rather than linked, so nothing is
   broken — but a list that stays unwritten for six months should be trimmed to the one that exists.

## Domains

    waterline-runway.com          the site
    app.waterline-runway.com      the app

The site links to `app.waterline-runway.com`. **It 404s until the DNS record answers** — which is
correct, because the site is not public until then either. Both go live together.

See GO-LIVE-waterline-runway.md for the ordered checklist. Note in particular that **Intuit needs no
change**: `QBO_REDIRECT_URI` points at Supabase, not at the app.

## Editing

**The HTML files are the source.** `_parts.py` documents the shared shell — nav, footer, head tags —
but it is NOT a working generator: the page bodies were written through it and not kept, so re-running
it would produce empty pages.

That is a flaw in how this was built, and it has one practical consequence: **a change to the nav or
footer has to be made in fourteen files.** Use a script, not fourteen edits:

    python3 - <<'EOF'
    import glob
    for f in glob.glob("**/*.html", recursive=True):
        s = open(f).read()
        s = s.replace("OLD", "NEW")
        open(f, "w").write(s)
    EOF

If the shell starts changing often, that is the signal to move to a real static-site generator — not
before.
