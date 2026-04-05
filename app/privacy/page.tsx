import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthenticatedProfileMenu,
  HistoryBack,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";

export const metadata: Metadata = {
  title: "Privacy | CT Pickup",
  description: "Privacy information for CT Pickup.",
};

export default function PrivacyPage() {
  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <div className="mt-4">
        <HistoryBack
          fallbackHref="/"
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-white/75 transition hover:text-white"
        />
      </div>
      <h1 className="mt-6 text-3xl font-semibold uppercase tracking-tight text-white md:text-4xl">
        Privacy
      </h1>
      <Panel className="mt-6 p-6 md:p-8">
        <div className="space-y-4 text-sm leading-relaxed text-white/75 md:text-base">
          <p>
            We collect information you provide when you create an account, join events,
            or submit forms—such as name, contact details, and messages you send us. We
            use it to operate CT Pickup, communicate with you, and improve our services.
          </p>
          <p>
            Authentication and data storage may be processed by our service providers
            (for example, Supabase) under their terms. Do not submit sensitive health or
            financial data unless a specific flow asks for it.
          </p>
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
          <p className="text-white/55">
            Contact us through{" "}
            <Link href="/help" className="text-white/75 underline-offset-4 hover:underline">
              Help
            </Link>{" "}
            for privacy-related requests where applicable.
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}
