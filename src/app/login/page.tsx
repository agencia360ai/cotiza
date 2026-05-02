import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Cotiza</h1>
          <p className="text-sm text-muted-foreground">
            Plataforma de cotizaciones HVAC para Panamá.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
