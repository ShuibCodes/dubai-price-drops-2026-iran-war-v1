import DashboardAccessGate from "@/components/access/dashboard-access-gate";

export default function DashboardRoute({ searchParams }) {
  return <DashboardAccessGate isDeveloperView={searchParams?.view === "developers"} />;
}
