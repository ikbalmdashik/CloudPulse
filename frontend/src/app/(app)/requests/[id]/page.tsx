import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestDetailView } from "@/components/requests/request-detail";

export const metadata: Metadata = { title: "Request" };

export default function RequestPage() {
  // The view reads the id with useParams and loads (and live-updates) on the client.
  return (
    <Suspense>
      <RequestDetailView />
    </Suspense>
  );
}
