// An advisor's view of one client: alerts, their runway chart, a tile per tab, and the advisor's own
// scenarios.
//
// READ-ONLY BY CONSTRUCTION. An advisor is always a viewer — the role gate refuses anything else — so
// this screen has exactly one writing act on it, which is the advisor's own scenario layer. Everything
// else is a door into the client's app.
//
// THE TILES ARE THE NAVIGATION. Clicking Payroll opens that client's Payroll tab, not their dashboard.
// An advisor between meetings already knows which part of the business they are worried about, and
// making them open the company and then find the tab is a step that exists only because the software
// was built company-first.
import React from "react";
import { money } from "../../engine/money";
import { advisorTiles } from "../../engine/advisor";
import { alertsFor } from "../../engine/alerts";
import { buildChart } from "../../engine/charts";
import { Chart } from "./Chart";
import { AdvisorScenarios } from "./AdvisorScenarios";

const TONE_VAR = {
  signal: "var(--signal-ink)", danger: "var(--danger)",
  caution: "var(--caution)", muted: "var(--muted)",
};

function tileValue(t) {
  if (t.format === "money") return money(t.value);
  if (t.format === "signedPercent") {
    const p = Math.round(t.value * 100);
    return `${p > 0 ? "+" : ""}${p}%`;
  }
  if (t.format === "text") return String(t.value);
  return `${t.value}${t.unit ? ` ${t.unit}` : ""}`;
}

export function AdvisorCompany({ company, doc, parts, hiddenTabs = [], account, onOpen, onError }) {
  // A CLIENT'S MODEL THAT WILL NOT LOAD SAYS SO. Reading as an empty company would be the worse
  // failure: an advisor would see a healthy-looking screen for a company they cannot actually see.
  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <div>
            <h3>{company?.name || "This company"}</h3>
            <p>Could not read this model. Nothing here is a figure about {company?.name || "them"}.</p>
          </div>
        </div>
      </section>
    );
  }

  // The scenarios panel reports its own list up, so the tile and the panel below it are reading one
  // fetch. Undefined until it arrives — which the tile builder treats as "not loaded", not "none".
  const [scenarios, setScenarios] = React.useState(undefined);
  // PASSED THROUGH, NOT SPREAD. `{ ...doc }` turns a null document into `{}` — truthy, empty, and
  // exactly the shape the tile layer refuses on purpose, because a model that would not load must not
  // report a burn of zero. The guard above catches it first today, so this was harmless and would not
  // have stayed that way.
  //
  // `myScenarios` is undefined until the panel below reports, which is not the same as none — the tile
  // layer already knows that difference and shows nothing rather than "0 scenarios".
  const tiles = advisorTiles(doc, { ...parts, myScenarios: scenarios }, { hidden: hiddenTabs });

  let alerts = [];
  try { alerts = alertsFor("dash", doc, parts) || []; } catch { alerts = []; }

  let runway = null;
  try { runway = buildChart("flow.runway", doc, parts); } catch { runway = null; }

  return (
    <>
      {alerts.map(a => (
        <div key={a.id} className={"alert " + (a.tone === "bad" ? "bad" : "warn")}>
          <span>{a.text}</span>
          {a.to && (
            <button className="linkbtn" onClick={() => onOpen?.(a.to)}>
              {a.action || "Open"} →
            </button>
          )}
        </div>
      ))}

      {runway && !runway.empty && (
        <section className="panel">
          <div className="panel-h">
            <div>
              <h3>Runway, with its range</h3>
              <p>Their model, their chart. Identical to what the owner sees.</p>
            </div>
            <button className="linkbtn" onClick={() => onOpen?.("flow")}>Cash flow →</button>
          </div>
          <Chart spec={runway} />
        </section>
      )}

      <section className="panel">
        <div className="panel-h">
          <div>
            <h3>Across their tabs</h3>
            <p>One tile per tab. Each opens that tab directly.</p>
          </div>
        </div>

        {tiles.length === 0 ? (
          <p className="acct-row-s">
            This model has nothing in it yet — no people, projects, revenue or rounds.
          </p>
        ) : (
          <div className="tabtiles">
            {tiles.map(t => (
              <button key={t.view} className={"tt" + (t.tone === "danger" ? " attn"
                                                    : t.tone === "caution" ? " warn" : "")}
                      onClick={() => onOpen?.(t.view)}>
                <span className="ttl">{t.label}</span>
                <span className="ttv" style={{ color: TONE_VAR[t.tone] || undefined }}>
                  {tileValue(t)}
                </span>
                <span className="tts">{t.sub}</span>
                {t.flag && <span className="ttf" title={t.flag}>⚑</span>}
              </button>
            ))}
          </div>
        )}
        <p className="acct-row-s" style={{ marginTop: 8 }}>
          {/* Said once, plainly, rather than repeated on every tile. */}
          Every figure here is the one that tab shows. Open a tab to change what it is built from.
        </p>
      </section>

      {/* THE ONE WRITING ACT ON THIS SCREEN. An advisor is always a viewer of the client's model, and
          their scenario layer is the entire answer to "so what can they actually do" — it is theirs
          until they offer it, and offering still leaves the decision with an owner.
          `AdvisorScenarios` already exists and is already parameterised; mounting it here rather than
          rebuilding a smaller version is what keeps one definition of what a scenario does. */}
      {account && company?.id && (
        <AdvisorScenarios account={account} companyId={company.id} doc={doc}
                          onCount={setScenarios} />
      )}
    </>
  );
}
