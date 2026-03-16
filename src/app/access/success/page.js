import AccessSuccessPage from "@/components/access/access-success-page";

export default function AccessSuccessRoute({ searchParams }) {
  return <AccessSuccessPage email={searchParams?.email ?? ""} />;
}
