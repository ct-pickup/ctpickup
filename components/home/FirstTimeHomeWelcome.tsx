"use client";

import DashboardWelcomeExperience from "@/components/dashboard/DashboardWelcomeExperience";

/** Logged-in first-run hub on `/` — matches `/dashboard` welcome styling. */
export default function FirstTimeHomeWelcome() {
  return <DashboardWelcomeExperience mode="firstVisitHome" />;
}
