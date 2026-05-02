import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { File, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { identifyGaps, hasCriticalGaps } from "@/lib/ai/identify-gaps";
import type { ProjectExtraction } from "@/lib/ai/types";
import { UploadZone } from "./upload-zone";
import { ExtractButton } from "./extract-button";
import { ExtractionCard } from "./extraction-card";
import { GapsForm } from "./gaps-form";
import { GenerateQuoteButton } from "./generate-quote-button";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, file_name, storage_path, mime_type, size_bytes, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  const { data: latestQuote } = await supabase
    .from("quotes")
    .select("id, quote_number, total_usd")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const extraction = (project.extracted_data ?? {}) as Partial<ProjectExtraction>;
  const hasExtraction = "source_summary" in extraction;
  const gaps = hasExtraction ? identifyGaps(extraction) : [];
  const blockedByGaps = hasCriticalGaps(extraction);

  return (
    <div className="px-10 py-8 max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground flex items-center gap-1.5">
        <Link href="/dashboard" className="hover:text-foreground">Proyectos</Link>
        <ChevronRight className="size-3.5" />
        <span>{project.name}</span>
      </nav>

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.client_name && (
            <p className="text-sm text-muted-foreground mt-1">Cliente: {project.client_name}</p>
          )}
          <p className="text-xs uppercase tracking-wider text-muted-foreground mt-2">
            {project.scope === "complex" ? "complejo" : "simple"} · {project.status}
          </p>
        </div>
        {latestQuote && (
          <Link
            href={`/quotes/${latestQuote.id}`}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Ver cotización · USD {Number(latestQuote.total_usd).toLocaleString("en-US")}
          </Link>
        )}
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">Documentos</h2>
        {documents && documents.length > 0 ? (
          <ul className="mb-4 flex flex-col gap-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <File className="size-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{d.file_name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {(Number(d.size_bytes) / 1024 / 1024).toFixed(1)} MB
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <UploadZone orgId={project.org_id} projectId={project.id} />
      </section>

      {documents && documents.length > 0 && (
        <section className="mb-8">
          <ExtractButton
            projectId={project.id}
            label={hasExtraction ? "Re-analizar documentos" : "Analizar con IA"}
          />
        </section>
      )}

      {hasExtraction && (
        <section className="mb-8">
          <ExtractionCard projectId={project.id} extraction={extraction as ProjectExtraction} />
        </section>
      )}

      {hasExtraction && gaps.length > 0 && (
        <section className="mb-8">
          <GapsForm projectId={project.id} gaps={gaps} />
        </section>
      )}

      {hasExtraction && (
        <section>
          <GenerateQuoteButton projectId={project.id} disabled={blockedByGaps} />
          {blockedByGaps && (
            <p className="text-xs text-muted-foreground mt-2">
              Completá los datos críticos arriba para habilitar la generación.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
