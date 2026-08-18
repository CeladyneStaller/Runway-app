// ── The advisor demo: the four sample companies as a portfolio ────────────────────────────────────
//
// ⚠️ NOT A FIFTH SAMPLE COMPANY. An advisor evaluating Waterline is not asking whether it models THEIR
// runway — they are asking whether it makes four other people's runways legible on a Tuesday morning.
// **The demo they need is the portfolio**, and the portfolio is the four documents that already exist.
//
// This implements the same surface `AdvisorHome` calls on the real account API, so **the advisor demo
// is the real advisor experience** — opening a client, running scenarios, reading a runway — rather
// than a picture of one. Nothing here is a mock; every number comes from `buildModelParts` over a real
// archetype document.

import { ARCHETYPES, archetypeById } from "./archetypes";
import { demoDoc } from "./document";

/** A stable id per client, so a route into one survives a reload. */
const cid = (id) => `demo-${id}`;

export const DEMO_ADVISOR_ID = "advisor";

/** Is this the advisor demo rather than a company demo? */
export const isAdvisorDemo = (which) => which === DEMO_ADVISOR_ID;

/** The document for one client, by the company id the portfolio handed out. */
export function demoClientDoc(companyId) {
  const found = ARCHETYPES.find(a => cid(a.id) === companyId);
  return found ? demoDoc(found.id) : null;
}

/**
 * An account API with exactly the methods the advisor surfaces call.
 *
 * ⚠️ THE SHAPE IS COPIED FROM WHAT `AdvisorHome` READS, not invented. A demo that returns a different
 * shape from the real API teaches the UI to handle two, and **the second one is always the one nobody
 * tests.**
 */
export function createDemoAdvisorApi() {
  const clients = ARCHETYPES.map(a => {
    const doc = demoDoc(a.id);
    return {
      company_id: cid(a.id),
      name: a.company,
      role: "advisor",
      is_advisor: true,
      // The portfolio row reads these; they are computed from the document rather than typed, so a
      // change to an archetype moves the portfolio with it.
      cash: doc.cash,
      kind: a.label,
    };
  });

  return {
    async listAdvisedCompanies() { return clients; },
    // ⚠️ AN ADVISOR IN THE DEMO IS ALWAYS WITHIN THEIR SEATS. Showing a demo advisor a paywall is
    // showing them the one part of the product they have not agreed to buy yet.
    async advisorUsage() { return { allowed: 10, used: clients.length }; },
    async companyTabs() { return []; },
    async setCompanyTabs() { /* the demo does not persist preferences */ },
    async members() { return []; },
  };
}

export const demoAdvisorClients = () => ARCHETYPES.map(a => ({ id: cid(a.id), archetype: a.id }));
