import { ARCHETYPES } from "../state/archetypes";
// ⚠️ `/icon-192.png` FROM `public/`, NOT THE SVG IN `assets/`. They are different crops of the same
// duck — the SVG has its own padding and rounding, so the header showed a mark that did not match the
// one a phone puts on a home screen. **Two versions of a logo is one too many.**
// A public path rather than an import: it is the same file the manifest serves, already cached.
const ICON = "/icon-192.png";
// ⚠️ IMPORTED, NOT A LITERAL PATH. The hashed filename in `dist` changes every build — hard-coding
// `/assets/waterline-mark-F8R1RrQe.svg` would work exactly until the next deploy.
import mark from "../assets/waterline-mark.svg";

/** The front door.
 *
 *  ⚠️ THE FOUR DEMOS ARE ON THE PAGE, NOT BEHIND A MODAL. Somebody clicking "Grant-funded company"
 *  should land in Ridgeline directly — **a modal asking the question they have just answered is the
 *  app not listening.** The picker stays for the banner switch, which is the only place the question is
 *  still open.
 *
 *  @param onDemo  (archetypeId) => void — opens that company straight away
 */
export function Landing({ onDemo, onCreate, onSignIn }) {
  return (
    <div className="rw">
      <div className="land">

        <div className="land-top">
          <div className="brandrow">
            {/* The shipped app icon, not a redrawn one — a landing page with its own version of the
                logo is a second mark nobody maintains. */}
            <img src={ICON} width="36" height="36" alt="" className="land-icon" />
            <span className="land-name">Waterline</span>
          </div>
          <button className="land-signin" onClick={onSignIn}>Sign in</button>
        </div>

        <div className="land-hero">
          <div>
            <div className="eyebrow">Runway clarity for complicated cash flow</div>
            <h2 className="land-h">Your funding is committed.<br /><em>Its timing is crucial.</em></h2>
            <p className="land-lead">
              Grants, invoices, and contracts pay late but your work can&rsquo;t wait. Waterline models
              cash on hand to provide runway visibility when timing matters most.
            </p>
            <p className="land-who">
              For teams funded by grants, investments, contracts, purchase orders, and subscriptions —
              find your waterline and keep your head above water.
            </p>
          </div>

          {/* ⚠️ THE GRAPHIC IS THE PRODUCT'S OWN CHART, drawn with the real tokens — the band, the
              dashed projection, the today marker and the zero line are what somebody sees ten seconds
              after signing up. **A landing image that does not appear in the product is a promise the
              product then has to keep.** */}
          <div className="land-viz" aria-hidden="true">
            <div className="land-viz-h">
              <span className="land-viz-l">Runway</span>
              <span className="land-viz-n">8.4 <span className="mo">mo</span></span>
            </div>
            <svg viewBox="0 0 360 210" role="img"
                 aria-label="A cash balance line inside a confidence band, crossing zero.">
              <path d="M14 48 L120 64 L230 90 L346 118 L346 150 L230 122 L120 92 L14 68 Z"
                    fill="var(--caution)" opacity=".14" />
              <path d="M14 54 L120 84 L230 122 L316 160 L346 180 L346 192 L316 176 L230 136 L120 98 L14 68 Z"
                    fill="var(--signal)" opacity=".22" />
              <line x1="14" y1="190" x2="346" y2="190" stroke="var(--danger)" strokeWidth="1.2"
                    strokeDasharray="3 4" />
              <text x="16" y="204" className="land-viz-t" fill="var(--danger)">out of cash</text>
              <path d="M14 62 L70 76 L120 90" fill="none" stroke="#fff" strokeWidth="2.6" />
              <path d="M120 90 L230 130 L316 166 L344 186" fill="none" stroke="var(--signal-2)"
                    strokeWidth="2.6" strokeDasharray="6 5" />
              <circle cx="120" cy="90" r="3.4" fill="#fff" />
              <text x="126" y="82" className="land-viz-t">today</text>
            </svg>
            <div className="land-viz-f">
              <span><i style={{ background: "#fff" }} />recorded</span>
              <span><i style={{ background: "var(--signal-2)" }} />projected</span>
              <span><i style={{ background: "var(--signal)", opacity: .5 }} />if nothing new lands</span>
            </div>
          </div>
        </div>

        <div className="ways">
          {/* ⚠️ NO `margin-top:auto` ON THE BUTTON. The demo tile is tall because it holds four; this
              one was stretched to match with a third of the content, and pinning the button to the
              bottom made the gap the main feature. The facts below answer the three objections
              somebody weighing "should I bother" actually has. */}
          <div className="way">
            <div className="way-t">Set up your company</div>
            <div className="way-s">
              Create an account and answer a few questions about your company to generate a real runway.
            </div>
            <button className="btn-go" onClick={onCreate}>Get started</button>
            <ul className="way-facts">
              <li>About ten minutes</li>
              <li>No card needed</li>
              <li>Build or import a company</li>
            </ul>
          </div>

          <div className="way">
            <div className="way-t">Open a demo to see how your company can use Waterline</div>
            <div className="way-s">
              Sample companies with real numbers. Edit anything to see how the model works. Nothing you
              do is saved.
            </div>
            <div className="demos">
              {/* ⚠️ READ FROM `ARCHETYPES`, NOT TYPED HERE. These four are already described in the
                  registry, the picker and the demo banner — **a fourth hand-written copy is a fourth
                  chance to describe Ridgeline differently from what Ridgeline contains.** */}
              {ARCHETYPES.map(a => (
                <button className="btn-demo" key={a.id} onClick={() => onDemo(a.id)}>
                  <span className="d-t">{a.label}</span>
                  <span className="d-s">{a.company} · {a.blurb}</span>
                </button>
              ))}
            </div>
          </div>

            {/* ⚠️ ADVISORS ARE A DIFFERENT BUYER, NOT A DIFFERENT PLAN. Somebody managing four clients is
                not asking whether Waterline models THEIR runway — they are asking whether it makes four
                other people's runways legible on a Tuesday morning. **The demo they need is the
                portfolio**, which is why this tile has its own button rather than sharing the four. */}
            <div className="way way-adv">
              <div className="way-t">Advise on several companies</div>
              <div className="way-s">One place for every client model you have been invited to, sorted by
                who needs you first.</div>
              <button className="btn-adv" onClick={onCreate}>Get started as an advisor</button>
              <button className="btn-demo btn-demo-adv" onClick={() => onDemo("advisor")}>
                <span className="d-t">Open the advisor demo</span>
                <span className="d-s">See how Waterline can help manage your portfolio — four sample
                  clients, two of them tight</span>
              </button>
              <ul className="way-facts">
                <li>Priced per advisor, not per client</li>
                <li>Clients invite you; you never hold their data</li>
              </ul>
            </div>
        </div>

        <div className="land-proof">
          <div className="pf">
            <div className="pf-ic pf-a">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round"><path d="M3 17 L9 11 L14 15 L21 7" /></svg>
            </div>
            <div className="pf-t">A range, not a date</div>
            <div className="pf-s">Runway to the month, with a floor and a ceiling — so you can show a
              board what is certain and what is not.</div>
          </div>
          <div className="pf">
            <div className="pf-ic pf-b">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round"><path d="M4 12 H20" /><path d="M14 6 L20 12 L14 18" /></svg>
            </div>
            <div className="pf-t">Money modelled properly</div>
            <div className="pf-s">Drawdowns, terms, cost share and the lag your funder actually takes —
              not the one in the agreement.</div>
          </div>
          <div className="pf">
            <div className="pf-ic pf-c">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round"><path d="M12 3 V21" /><path d="M5 8 H19" /></svg>
            </div>
            <div className="pf-t">Your ledger, checked</div>
            <div className="pf-s">Import what you actually spent and see where the model was wrong. A
              projection nobody checks is a guess.</div>
          </div>
        </div>

        <div className="land-foot">
          {/* The footer had no mark at all. It is the last thing on the page and the one place a
              visitor looks for who made this. */}
          <span className="land-footmark">
            <img src={mark} alt="Waterline" width="100" />
          </span>
          <span>Already have an account?{" "}
            <button className="linkbtn" onClick={onSignIn}>Sign in</button></span>
          <span>
            <a href="https://www.waterline-runway.com/terms/">Terms</a> ·{" "}
            <a href="https://www.waterline-runway.com/privacy/">Privacy</a>
          </span>
        </div>
      </div>

    </div>
  );
}
