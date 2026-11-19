import { AccountChooser } from "@/components/auth/account-chooser";
import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <Brand className="text-lg" />
      <AccountChooser />
      <div className="w-full max-w-sm">{children}</div>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Service request management for IT infrastructure and cloud operations.
      </p>
    </main>
  );
}
