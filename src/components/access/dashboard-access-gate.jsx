"use client";

import DashboardPage from "@/components/dashboard/dashboard-page";

export default function DashboardAccessGate({ isDeveloperView = false }) {
  return <DashboardPage isDeveloperView={isDeveloperView} />;
}
