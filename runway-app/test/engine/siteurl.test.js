// Where an emailed auth link comes back to. The failure this guards is quiet: the email sends, the
// token is valid, and the link opens the wrong host — a Vercel preview behind Deployment Protection,
// or whatever Supabase falls back to when a redirect isn't on its allow-list.
import { describe, it, expect } from "vitest";
import { siteOrigin, linkDestination } from "../../src/state/siteurl";

const loc = (origin) => ({ origin });

describe("choosing the origin", () => {
  it("prefers the configured canonical site over wherever we happen to be", () => {
    // THE FIX. Ask for a link from a preview deployment and it must still come back to production.
    expect(siteOrigin({ VITE_SITE_URL: "https://runway.example.com" },
                      loc("https://runway-git-branch.vercel.app"))).toBe("https://runway.example.com");
  });

  it("falls back to the current origin, so local dev needs no configuration", () => {
    expect(siteOrigin({}, loc("http://localhost:5173"))).toBe("http://localhost:5173");
  });

  it("normalises to a bare origin — an allow-list compares strings", () => {
    expect(siteOrigin({ VITE_SITE_URL: "https://runway.example.com/" }, null)).toBe("https://runway.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "https://runway.example.com/app?x=1" }, null)).toBe("https://runway.example.com");
  });

  it("ignores junk rather than sending anybody to it", () => {
    // A malformed value must not become a redirect target; unset is the safer reading.
    expect(siteOrigin({ VITE_SITE_URL: "not a url" }, loc("https://real.example.com"))).toBe("https://real.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "javascript:alert(1)" }, loc("https://real.example.com"))).toBe("https://real.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "   " }, loc("https://real.example.com"))).toBe("https://real.example.com");
  });

  it("returns null when there is nothing to go on", () => {
    expect(siteOrigin({}, null)).toBeNull();
  });
});

describe("saying where the link will open", () => {
  it("names the host, so a wrong destination is visible instead of silent", () => {
    expect(linkDestination({}, loc("https://runway.example.com"))).toMatchObject({
      host: "runway.example.com", ephemeral: false,
    });
  });

  it("flags per-deployment hosts, which are the ones behind login walls", () => {
    for (const h of ["x.vercel.app", "x.netlify.app", "x.pages.dev", "x.onrender.com"]) {
      expect(linkDestination({}, loc(`https://${h}`)).ephemeral).toBe(true);
    }
  });

  it("stops flagging once a canonical site is configured", () => {
    // With VITE_SITE_URL set, the preview host is no longer where the link goes.
    expect(linkDestination({ VITE_SITE_URL: "https://runway.example.com" },
                           loc("https://x.vercel.app"))).toMatchObject({ host: "runway.example.com", ephemeral: false });
  });

  it("does not flag an ordinary domain", () => {
    expect(linkDestination({}, loc("https://app.acme.co")).ephemeral).toBe(false);
    expect(linkDestination({}, loc("http://localhost:5173")).ephemeral).toBe(false);
  });
});
