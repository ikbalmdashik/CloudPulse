import type { Metadata } from "next";
import { NewRequestForm } from "@/components/requests/new-request-form";

export const metadata: Metadata = { title: "New request" };

export default function NewRequestPage() {
  return <NewRequestForm />;
}
