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
  title: "Terms | CT Pickup",
  description: "Terms of use for CT Pickup.",
};

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
        Terms
      </h1>
      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-4 text-sm leading-relaxed text-white/75 md:text-base">
          <p>
            CT Pickup provides scheduling, community, and related services for soccer and
            association football activities, including pickup games, tournaments,
            training, and guidance.
          </p>
          <p>
            Use of the platform and participation in any activities connected to it are
            subject to our policies and the{" "}
            <Link
              href="/liability-waiver"
              className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
            >
              Liability Waiver &amp; Participation Agreement
            </Link>
            .
          </p>
          <p>
            Specific programs may have additional rules posted on their respective pages.
            By continuing to use the platform or participate in any activities, you agree
            to follow all applicable rules and to conduct yourself responsibly and
            respectfully.
          </p>
          <p className="text-white/55">
            For questions, visit{" "}
            <Link href="/help" className="text-white/75 underline-offset-4 hover:underline">
              Help
            </Link>{" "}
            or email{" "}
            <SupportEmailLink className="font-medium text-white/75 underline underline-offset-4 hover:text-white/90" />
            .
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}
