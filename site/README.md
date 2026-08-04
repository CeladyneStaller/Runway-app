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
3. **A real inbox** at hello@waterline.app. The address appears on five pages.
4. **The five unwritten articles.** They are listed as "Coming" rather than linked, so nothing is
   broken — but a list that stays unwritten for six months should be trimmed to the one that exists.

## Editing

`_parts.py` holds the nav and footer. Change them there and re-run the page scripts rather than editing
fourteen copies — a hand-edited nav is a nav that is wrong on three pages.
