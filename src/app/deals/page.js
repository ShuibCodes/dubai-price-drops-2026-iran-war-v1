import DashboardAccessGate from "@/components/access/dashboard-access-gate";
import TimeOnPageGoals from "@/components/analytics/time-on-page-goals";

export default function DealsRoute({ searchParams }) {
  return (
    <>
      <TimeOnPageGoals prefix="deals_stayed" milestones={[30, 120, 300]} />
      <DashboardAccessGate isDeveloperView={searchParams?.view === "developers"} />
    </>
  );
}
