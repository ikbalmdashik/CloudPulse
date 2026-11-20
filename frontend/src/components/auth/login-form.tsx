"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type SavedAccount, useLogin, useSavedAccounts } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { type LoginForm as LoginValues, loginFormSchema } from "@/lib/validation";
import { PasswordInput } from "./password-input";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useLogin();
  const { data: savedAccounts } = useSavedAccounts();
  // Set when the submitted email belongs to an account already signed in here.
  const [duplicate, setDuplicate] = useState<{ account: SavedAccount; values: LoginValues } | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: params.get("email") ?? "", password: "", rememberMe: false },
  });

  // base-ui's Input keeps its own copy of the value, so reset() alone leaves the
  // old text on screen; bumping the key remounts the fields empty.
  const [fieldsKey, setFieldsKey] = useState(0);
  const clearFields = () => {
    reset({ email: "", password: "", rememberMe: false });
    setFieldsKey((k) => k + 1);
  };

  const submit = (values: LoginValues) => login.mutate(values, { onSuccess: () => router.replace("/") });

  const onSubmit = handleSubmit((values) => {
    const email = values.email.trim().toLowerCase();
    const account = savedAccounts?.find((a) => a.email.toLowerCase() === email);
    if (account) return setDuplicate({ account, values });
    submit(values);
  });

  // "Continue": log in anyway (this replaces that account's old session here).
  const confirmDuplicate = () => {
    if (!duplicate) return;
    submit(duplicate.values);
    setDuplicate(null);
    clearFields();
  };

  // "Cancel": keep the existing session and clear the form.
  const cancelDuplicate = () => {
    setDuplicate(null);
    clearFields();
  };

  const serverError =
    login.error instanceof ApiError
      ? login.error.status === 400
        ? "Check your email and password."
        : login.error.message
      : login.error
        ? "Something went wrong. Please try again."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Log in</CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
      </CardHeader>
      <form key={fieldsKey} onSubmit={onSubmit} noValidate>
        <CardContent>
          <FieldGroup>
            {params.get("registered") && !login.error && (
              <Alert>
                <CircleCheckIcon />
                <AlertDescription>Account created. Log in to get started.</AlertDescription>
              </Alert>
            )}
            {serverError && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
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
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...register("password")}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <Controller
              control={control}
              name="rememberMe"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="rememberMe"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    aria-describedby="rememberMe-hint"
                  />
                  <div className="grid gap-1 leading-none">
                    <FieldLabel htmlFor="rememberMe" className="font-normal">
                      Remember me
                    </FieldLabel>
                    <FieldDescription id="rememberMe-hint" className="text-xs">
                      {field.value
                        ? "Stay signed in on this device for 30 days. Don't use this on a shared computer."
                        : "You'll be signed out when you close the browser."}
                    </FieldDescription>
                  </div>
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3">
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending && <Loader2Icon className="animate-spin" />}
            Log in
          </Button>
          <p className="text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
      <Dialog open={duplicate !== null} onOpenChange={(open) => !open && cancelDuplicate()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Account already logged in</DialogTitle>
            <DialogDescription>
              {duplicate && (
                <>
                  <span className="font-medium text-foreground">{duplicate.account.fullName}</span> (
                  {duplicate.account.email}) is already logged in on this browser. Continue to log in again and
                  replace that session?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={confirmDuplicate}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
