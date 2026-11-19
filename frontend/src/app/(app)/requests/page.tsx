import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestsList } from "@/components/requests/requests-list";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  // The list reads its filters from the query string, so it needs a Suspense boundary.
  return (
    <Suspense>
      <RequestsList />
    </Suspense>
  );
}
