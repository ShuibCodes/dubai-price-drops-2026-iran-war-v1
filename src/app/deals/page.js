import DashboardAccessGate from "@/components/access/dashboard-access-gate";

export default function DealsRoute({ searchParams }) {
  return <DashboardAccessGate isDeveloperView={searchParams?.view === "developers"} />;
}
