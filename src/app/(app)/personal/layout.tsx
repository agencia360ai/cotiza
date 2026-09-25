import { exigirSeccion } from "@/lib/acceso";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirSeccion("personal");
  return children;
}
