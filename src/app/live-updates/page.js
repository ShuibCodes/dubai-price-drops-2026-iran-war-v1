import DashboardAccessGate from "@/components/access/dashboard-access-gate";

export default function TheDXPDipRoute({ searchParams }) {
  return <DashboardAccessGate isDeveloperView={searchParams?.view === "developers"} />;
}
