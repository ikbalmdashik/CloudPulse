import type { Metadata } from "next";
import { RequestsList } from "@/components/requests/requests-list";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return <RequestsList />;
}
