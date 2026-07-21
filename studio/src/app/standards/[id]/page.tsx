import { redirect } from "next/navigation";

// The per-document clause list was merged into the unified /standards library view.
export default async function StandardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/standards?doc=${encodeURIComponent(decodeURIComponent(id))}`);
}
