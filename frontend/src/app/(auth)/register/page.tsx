import type { Metadata } from "next";
import { ResetOnAccountChange } from "@/components/auth/reset-on-account-change";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <ResetOnAccountChange>
      <RegisterForm />
    </ResetOnAccountChange>
  );
}
