// Where a person lands when they sign in.
//
// A PURE RULE, kept out of the component that acts on it, because "which screen" is a decision with
// four inputs and several ways to be subtly wrong — and because the settings UI needs the same answer
// to show somebody what their current default resolves to.
//
// THE PORTFOLIO IS AN ADVISOR SCREEN AND NOTHING ELSE. Somebody with two companies of their own is not
// running a portfolio; they are switching between two models. Showing them a client list they cannot
// have is a feature advertising itself to people who cannot use it, and the rules below BLOCK it rather
// than hide it — a stored preference pointing at the portfolio is refused for a non-advisor, not
// silently honoured if they ever gain the flag.

/** The screens a landing preference may name. */
export const PORTFOLIO = "portfolio";

const clean = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);

/** May this person see the portfolio at all? */
export function portfolioAllowed({ isAdvisor = false } = {}) {
  return !!isAdvisor;
}

/** The company somebody lands on when they have expressed no preference.
 *
 *  OWNED FIRST, THEN OLDEST. Owning a company is the strongest signal that it is *yours* rather than
 *  one you were invited to, and among equals the oldest is the one they have had longest — a stabler
 *  answer than "most recently joined", which would move the landing every time somebody adds them to
 *  something.
 */
export function defaultCompany(companies = []) {
  const list = (companies || []).filter(c => c && c.id);
  if (!list.length) return null;

  const byAge = (a, b) => {
    const at = Date.parse(a.joined_at || a.created_at || "") || 0;
    const bt = Date.parse(b.joined_at || b.created_at || "") || 0;
    return at - bt;                       // oldest first
  };

  const owned = list.filter(c => c.role === "owner").sort(byAge);
  return (owned[0] || [...list].sort(byAge)[0]).id;
}

/** Where to land.
 *
 *  Returns `{ view, companyId, blocked }`:
 *    view       PORTFOLIO, or "company"
 *    companyId  which one, when the view is "company"
 *    blocked    true when a stored preference could not be honoured, so the caller can decide whether
 *               to say so. NOT an error — a preference pointing at a company somebody has left is an
 *               ordinary consequence of being removed, and should land them somewhere sensible without
 *               a warning about it.
 */
export function landingFor({ companies = [], isAdvisor = false, preferred = null } = {}) {
  const list = (companies || []).filter(c => c && c.id);
  const want = clean(preferred);
  const mayPortfolio = portfolioAllowed({ isAdvisor });

  if (!list.length) {
    // An advisor with no clients still gets the portfolio: it is the screen that explains what happens
    // next, where an empty company model would not.
    return { view: mayPortfolio ? PORTFOLIO : "company", companyId: null, blocked: false };
  }

  // ONE COMPANY IS NOT A PORTFOLIO, whatever is stored and whatever the flag says. An advisor advising
  // exactly one client is looking at one company; a list of one is a worse version of that company.
  if (list.length === 1 && !mayPortfolio) {
    return { view: "company", companyId: list[0].id, blocked: want === PORTFOLIO };
  }

  if (want === PORTFOLIO) {
    return mayPortfolio
      ? { view: PORTFOLIO, companyId: null, blocked: false }
      // Refused rather than honoured: a preference stored while somebody was an advisor must not
      // survive them ceasing to be one.
      : { view: "company", companyId: defaultCompany(list), blocked: true };
  }

  if (want) {
    const found = list.find(c => c.id === want);
    if (found) return { view: "company", companyId: found.id, blocked: false };
    // Named a company they are no longer in. Fall through to the default without complaint.
    return { view: "company", companyId: defaultCompany(list), blocked: true };
  }

  // No preference: advisors get the portfolio, everybody else gets their company.
  return mayPortfolio
    ? { view: PORTFOLIO, companyId: null, blocked: false }
    : { view: "company", companyId: defaultCompany(list), blocked: false };
}

/** The choices to offer in settings, in the order they should appear. */
export function landingChoices({ companies = [], isAdvisor = false } = {}) {
  const out = [];
  if (portfolioAllowed({ isAdvisor })) {
    out.push({ value: PORTFOLIO, label: "Your portfolio", hint: "every client you advise" });
  }
  for (const c of companies || []) {
    if (c?.id) out.push({ value: c.id, label: c.name || "Untitled company", hint: c.role });
  }
  return out;
}
