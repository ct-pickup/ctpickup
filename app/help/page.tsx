import Topbar from "@/components/Topbar";

export default function HelpPage() {
  return (
    <main className="ct-page">
      <div className="ct-container">
        <Topbar />
          <div className="ct-nav">
            <a href="/status">Status</a>
            <a href="/help">Help</a>
          </div>
        </div>

        <h1 className="ct-title">Help</h1>
        <p className="ct-sub">
          Quick answers. If it’s not here, check Status first.
        </p>

        <div className="mt-6 grid gap-3">
          <div className="ct-card">
            <div className="ct-k">How this works</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              Submit your tournament availability once. We use the data to lock the best
              day/time and finalize teams. The Status page is the official source of truth.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">What happens after I submit?</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              If your slot hits critical mass, a CT Pickup member will contact you.
              Expected response window: 24–48 hours.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Where do updates live?</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              Tournament updates are posted on the Status page. General announcements may
              also be posted on Instagram story.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Fixing your submission</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              If your availability changes, use{" "}
              <a className="underline" href="/update">Fix / Edit My Submission</a>.
              Don’t DM captains with changes. Keep it in the system.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Captain responsibilities</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              Captains are the point of contact. Create one iMessage group chat for your team
              and make sure every player submits the form to be eligible.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Cancellation policy</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              You can cancel up to 48 hours before the tournament for a refund.
              Inside 48 hours: no refund.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Troubleshooting</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              If you can’t access Tournament, you may be logged out or missing a profile.
              Log in again and complete onboarding.
            </div>
          </div>
        </div>

        <div className="ct-foot">
          Tip: bookmark{" "}
          <a className="underline" href="/status">/status</a>.
        </div>
      </div>
    </main>
  );
}
