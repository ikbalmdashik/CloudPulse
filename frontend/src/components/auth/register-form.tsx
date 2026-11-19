"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRegister } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { type RegisterForm as RegisterValues, registerFormSchema } from "@/lib/validation";
import { PasswordInput } from "./password-input";

const FIELDS = ["fullName", "email", "password"] as const;
const EMPTY: RegisterValues = { fullName: "", email: "", password: "", confirmPassword: "" };

export function RegisterForm() {
  const router = useRouter();
  const signUp = useRegister();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = handleSubmit(({ fullName, email, password }) =>
    signUp.mutate({ fullName, email, password }, {
      onSuccess: (user) =>
        router.push(`/login?registered=1&email=${encodeURIComponent(user.email)}`),
      onError: (err) => {
        if (!(err instanceof ApiError)) return;
        if (err.status === 409) {
          setError("email", { message: "An account with this email already exists" }, { shouldFocus: true });
        } else if (err.status === 400) {
          // Show the server's per-field messages under the matching inputs.
          const byField = err.fieldErrors();
          for (const f of FIELDS) if (byField[f]) setError(f, { message: byField[f] });
        }
      },
    }),
  );

  const formError =
    signUp.error instanceof ApiError && ![400, 409].includes(signUp.error.status)
      ? signUp.error.message
      : signUp.error && !(signUp.error instanceof ApiError)
        ? "Something went wrong. Please try again."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create an account</CardTitle>
        <CardDescription>
          New accounts start as operators. An admin can promote you to supervisor.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent>
          <FieldGroup>
            {formError && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={!!errors.fullName}>
              <FieldLabel htmlFor="fullName">Full name</FieldLabel>
              <Input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} {...register("fullName")} />
              <FieldError errors={[errors.fullName]} />
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                aria-describedby="password-hint"
                {...register("password")}
              />
              {errors.password ? (
                <FieldError errors={[errors.password]} />
              ) : (
                <FieldDescription id="password-hint">
                  At least 8 characters, with a letter and a digit.
                </FieldDescription>
              )}
            </Field>
            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmPassword}
                {...register("confirmPassword")}
              />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3">
          <Button type="submit" className="w-full" disabled={signUp.isPending}>
            {signUp.isPending && <Loader2Icon className="animate-spin" />}
            Create account
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
