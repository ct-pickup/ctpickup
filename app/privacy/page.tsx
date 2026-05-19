import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  HistoryBack,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { SupportEmailLink } from "@/components/SupportEmailLink";

export const metadata: Metadata = {
  title: "Privacy | CT Pickup",
  description: "Privacy information for CT Pickup.",
};

const PROCESSORS = [
  {
    name: "Stripe",
    use: "Payment processing for pickup runs and tournaments",
    href: "https://stripe.com/privacy",
  },
  {
    name: "Supabase",
    use: "Database storage and user authentication",
    href: "https://supabase.com/privacy",
  },
  {
    name: "Sentry",
    use: "Crash reporting and error monitoring",
    href: "https://sentry.io/privacy/",
  },
  {
    name: "OpenAI",
    use: "Help assistant — your questions are sent to OpenAI's API to generate responses",
    href: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "Expo",
    use: "Push notification delivery to your device",
    href: "https://expo.dev/privacy",
  },
  {
    name: "Google Maps",
    use: "Drive-time calculations for venue proximity matching",
    href: "https://policies.google.com/privacy",
  },
] as const;

export default function PrivacyPage() {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />
      <div className="mt-4">
        <HistoryBack
          fallbackHref="/"
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-white/75 transition hover:text-white"
        />
      </div>
      <h1 className="mt-6 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Privacy Policy
      </h1>
      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-6 text-sm leading-relaxed text-white/75 md:text-base">
          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Data we collect</h2>
            <p className="mt-2">
              We collect information you provide when you use CT Pickup: your name, email,
              Instagram handle, playing position, ZIP code, nearest venue preference, and
              reliability score (based on attendance). We also collect account activity such
              as event registrations and messages you send within the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">How we use your information</h2>
            <p className="mt-2">
              We use your information to operate the app, match you with nearby pickup runs
              and tournaments, process payments, send essential notifications, calculate
              reliability scores, provide customer support, and improve the platform.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Third-party processors</h2>
            <p className="mt-2">
              We use trusted service providers to run CT Pickup. Each processes data only as
              needed to provide their service:
            </p>
            <ul className="mt-3 list-disc space-y-3 pl-5">
              {PROCESSORS.map((p) => (
                <li key={p.name}>
                  <span className="font-medium text-white/90">{p.name}</span> — {p.use}.{" "}
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
                  >
                    Privacy policy
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Location</h2>
            <p className="mt-2">
              We use your ZIP code and venue selection for proximity matching. We do not
              access GPS or continuous location tracking on your device.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">AI disclosure</h2>
            <p className="mt-2">
              Our Help assistant uses OpenAI to generate responses. Questions you ask in Help
              are sent to OpenAI&apos;s API. Do not share sensitive personal information in Help
              chat.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Data retention</h2>
            <p className="mt-2">
              Account data is kept until you delete your account. Payment and transaction
              records are retained for up to 7 years for legal and tax compliance.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Account deletion</h2>
            <p className="mt-2">
              You can delete your account at any time. Go to Profile → scroll to bottom →
              Delete Account. This permanently removes all your data from CT Pickup.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Children</h2>
            <p className="mt-2">
              CT Pickup is for users 13 and older. We do not knowingly collect data from
              children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white md:text-lg">Content moderation</h2>
            <p className="mt-2">
              We review reported content within 24–48 hours. Contact{" "}
              <SupportEmailLink /> for urgent issues.
            </p>
          </section>

          <section>
            <p>
              Participation in tournaments and guidance is also covered by our{" "}
              <Link
                href="/liability-waiver"
                className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Liability Waiver &amp; Participation Agreement
              </Link>
              .
            </p>
          </section>

          <p className="text-white/55">
            Questions about privacy? Contact <SupportEmailLink />.
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}
