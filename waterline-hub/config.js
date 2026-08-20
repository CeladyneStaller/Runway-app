// Deployment config for Waterline HQ.
//
// ⚠️ THIS FILE IS YOURS, NOT MINE. It is separated from `index.html` precisely so a patch that rewrites
// the page cannot clobber it — **which is the problem this exists to solve.** Nothing I ship will
// overwrite this file.
//
// The PUBLISHABLE key only. It is already in the customer app's bundle and readable by anyone who
// opens devtools there, so it is safe in client source. **The secret key would not be** — it would be
// served to every visitor of this page.
window.WATERLINE_ANON_KEY = "sb_publishable_aCKlwnqix0M3mnI81bhBfw_6wV-CYQn";
