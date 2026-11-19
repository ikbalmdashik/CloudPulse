import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetOnAccountChange } from "@/components/auth/reset-on-account-change";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  // LoginForm reads the query string (?registered, ?email), so it needs a Suspense boundary.
  return (
    <Suspense>
      <ResetOnAccountChange>
        <LoginForm />
      </ResetOnAccountChange>
    </Suspense>
  );
}
