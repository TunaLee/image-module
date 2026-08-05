import { InspectionDetail } from "../../../components/inspection-detail";

export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InspectionDetail id={id} />;
}
