import { LoginForm } from "@/components/LoginForm";

export default function FahrerLoginPage() {
  return (
    <LoginForm
      role="DRIVER"
      redirectTo="/fahrer"
      title="Fahrerportal"
    />
  );
}
