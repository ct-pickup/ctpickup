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
  title: "Terms of Service | CT Pickup",
  description: "Terms of Service for CT Pickup.",
};

const linkClass =
  "font-medium text-[var(--brand)] underline-offset-4 hover:underline";

export default function TermsPage() {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <div className="mt-4">
        <HistoryBack
          fallbackHref="/"
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-white/75 transition hover:text-white"
        />
      </div>
      <h1 className="mt-6 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Terms of Service
      </h1>
      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-8 text-sm leading-relaxed text-white/75 md:text-base">
          <section>
            <h2 className="text-base font-semibold text-white">
              1. Acceptance of Terms
            </h2>
            <p className="mt-3">
              By downloading, accessing, or using CT Pickup you agree to be bound by these
              Terms of Service. If you do not agree to these terms, do not use the platform.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">
              2. Intellectual Property
            </h2>
            <p className="mt-3">
              CT Pickup, including its name, logo, design, source code, software, content,
              features, and functionality are the exclusive intellectual property of CT Pickup
              and its founders and are protected by applicable intellectual property laws. All
              rights reserved. Unauthorized use of any part of the platform is strictly
              prohibited.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">
              3. Prohibited Activities
            </h2>
            <p className="mt-3">Users may not:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Copy, reproduce, distribute, or create derivative works based on CT Pickup or
                any part of it
              </li>
              <li>
                Reverse engineer, decompile, disassemble, or attempt to extract the source code
                of the app
              </li>
              <li>
                Use automated tools, bots, or scrapers to access any part of the platform
              </li>
              <li>
                Use any information or insights gained from using CT Pickup to build, assist,
                or advise any competing product or service
              </li>
              <li>
                Access the platform through unauthorized means or attempt to bypass any security
                measures
              </li>
              <li>
                Impersonate any person or entity or misrepresent your affiliation with any person
                or entity
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">4. User Content</h2>
            <p className="mt-3">
              By posting messages or content on CT Pickup you grant CT Pickup a non-exclusive
              license to display your content within the platform. You retain ownership of your
              content. You are solely responsible for any content you post.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">5. Code of Conduct</h2>
            <p className="mt-3">
              Users must treat all other players and staff with respect. CT Pickup reserves the
              right to suspend or permanently ban any user for harassment, abusive behavior,
              unsportsmanlike conduct, or any violation of these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">6. Payments and Refunds</h2>
            <p className="mt-3">
              All pickup run and tournament fees are processed securely through Stripe. Refund
              eligibility is determined by the cancellation policy displayed at the time of
              payment. CT Pickup reserves the right to modify pricing at any time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">7. Assumption of Risk</h2>
            <p className="mt-3">
              Participation in CT Pickup pickup runs and tournaments involves physical activity
              and inherent risk of injury. By participating you acknowledge and accept these risks.
              CT Pickup is not responsible for any injuries, losses, or damages that occur during
              or in connection with any event.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">8. Termination</h2>
            <p className="mt-3">
              CT Pickup reserves the right to suspend or terminate any account at any time, with
              or without notice, for violation of these terms or for any other reason at our
              sole discretion.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">
              9. Disclaimer of Warranties
            </h2>
            <p className="mt-3">
              CT Pickup is provided as-is and as-available without warranties of any kind,
              either express or implied. We do not guarantee that the platform will be
              uninterrupted, error-free, or free of harmful components.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">
              10. Limitation of Liability
            </h2>
            <p className="mt-3">
              To the fullest extent permitted by law, CT Pickup and its founders shall not be
              liable for any indirect, incidental, special, or consequential damages arising
              from your use of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">11. Governing Law</h2>
            <p className="mt-3">
              These terms are governed by and construed in accordance with the laws of the State
              of Connecticut, United States, without regard to its conflict of law provisions.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">12. Changes to Terms</h2>
            <p className="mt-3">
              We reserve the right to update these terms at any time. Continued use of the
              platform after changes constitutes acceptance of the new terms. We will notify
              users of material changes through the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">13. Contact</h2>
            <p className="mt-3">
              For questions about these terms contact us at:{" "}
              <SupportEmailLink className={linkClass} />
            </p>
          </section>

          <p className="border-t border-white/10 pt-6 text-sm text-white/55">
            Related:{" "}
            <Link href="/privacy" className="text-white/75 underline-offset-4 hover:underline">
              Privacy
            </Link>
            ,{" "}
            <Link
              href="/liability-waiver"
              className="text-white/75 underline-offset-4 hover:underline"
            >
              Liability Waiver
            </Link>
            . For general help, visit{" "}
            <Link href="/help" className="text-white/75 underline-offset-4 hover:underline">
              Help
            </Link>
            .
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}
