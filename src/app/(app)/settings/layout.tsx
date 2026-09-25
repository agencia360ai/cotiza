import { exigirConfiguracion } from "@/lib/acceso";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirConfiguracion();
  return children;
}
