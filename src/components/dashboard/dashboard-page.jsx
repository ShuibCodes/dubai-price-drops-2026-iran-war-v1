"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import AlertButton from "@/components/dashboard/alert-button";

const SalesMainDashboard = dynamic(
  () => import("@/components/dashboard/sales-main-dashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 px-4 py-20 text-sm text-white/50 sm:px-6 lg:px-8">
        <p>Loading sales dashboard…</p>
      </div>
    ),
  }
);

const SalesDashboard = dynamic(
  () => import("@/components/dashboard/sales-dashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 px-4 py-20 text-sm text-white/50 sm:px-6 lg:px-8">
        <p>Loading sales dashboard…</p>
      </div>
    ),
  }
);

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const isDeveloperView = view === "developers";

  return (
    <main className="dashboard-shell min-h-screen pb-10 text-white sm:pb-14">
      <AlertButton />
      {isDeveloperView ? (
        <SalesDashboard homeHref="/live-updates" />
      ) : (
        <SalesMainDashboard developerHref="/live-updates?view=developers" />
      )}
    </main>
  );
}
