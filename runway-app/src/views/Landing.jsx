import React from "react";

// The first screen. Its whole job is to make the fork BEFORE anybody looks at a password field.
//
// It used to be that `SignIn` was the landing screen, which meant the cheapest possible way to
// understand this product — open the demo — was a text link at the very bottom, underneath a password
// input, a forgotten-password link, a magic-link button and a Google button. Somebody who has not yet
// decided whether they want the thing was being asked to authenticate to it.
//
// Two doors, both real, and sign-in demoted to a line of text — not because returning users matter
// less, but because they already know what they are looking for and new visitors do not.

export function Landing({ onDemo, onCreate, onSignIn }) {
  return (
    <div className="rw"><div className="splash landing">
      <span className="eyebrow">Startup runway</span>
      <h2>Know your runway</h2>
      <p>See how it works, or set up your company.</p>

      <div className="landing-doors">
        <div className="landing-door">
          <h3>Look around first</h3>
          <p>A sample company with real numbers in it. Edit anything — the projection moves like it
            would for you.</p>
          <button className="addbtn ghost landing-go" onClick={onDemo}>Open the demo</button>
          <div className="landing-fine">No email. It resets after twelve hours, and you can keep it
            if you decide to.</div>
        </div>

        <div className="landing-door primary">
          <h3>Set up your company</h3>
          <p>A few questions about cash, people and projects. Your runway is a real number by the end
            of it.</p>
          <button className="addbtn landing-go" onClick={onCreate}>Get started</button>
          <div className="landing-fine">Already have a model in a file? You can bring it in instead.</div>
        </div>
      </div>

      <div className="landing-foot">
        Already have an account? <button className="linkbtn" onClick={onSignIn}>Sign in</button>
      </div>
    </div></div>
  );
}
