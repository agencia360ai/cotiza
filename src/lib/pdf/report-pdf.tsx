import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { EquipmentStatus, Recommendation } from "@/lib/maintenance/types";

const STATUS_COLOR: Record<string, string> = {
  operativo: "#10B981",
  atencion: "#F59E0B",
  critico: "#EF4444",
  fuera_de_servicio: "#6B7280",
  sin_inspeccion: "#94A3B8",
};
const STATUS_LABEL: Record<string, string> = {
  operativo: "Operativo",
  atencion: "Requiere atención",
  critico: "Crítico",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};
const REPORT_TYPE_LABEL: Record<string, string> = {
  preventivo: "Mantenimiento Preventivo",
  correctivo: "Reparación Correctiva",
  instalacion: "Nueva Instalación",
  inspeccion: "Inspección",
};
const PRIORITY_COLOR: Record<string, string> = {
  alta: "#EF4444",
  media: "#F59E0B",
  baja: "#10B981",
};
const PRIORITY_LABEL: Record<string, string> = {
  alta: "ALTA",
  media: "MEDIA",
  baja: "BAJA",
};

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9.5, color: "#0F172A" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 34, height: 34, borderRadius: 6, objectFit: "cover" },
  brandName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#0F172A" },
  brandTag: { fontSize: 8, color: "#64748B" },
  reportMeta: { alignItems: "flex-end" },
  reportNumber: { fontSize: 9, color: "#64748B" },
  statusPill: { marginTop: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },

  heroCard: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, padding: 16, marginBottom: 16 },
  typeTag: { alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  clientName: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#0F172A" },
  metaLine: { fontSize: 9, color: "#475569", marginTop: 3 },

  sectionTitle: { fontSize: 8.5, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  summaryBox: { backgroundColor: "#F8FAFC", borderRadius: 6, padding: 12, marginBottom: 16, lineHeight: 1.5, fontSize: 10, color: "#334155" },

  countsRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  countCard: { flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 6, alignItems: "center" },
  countNum: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  countLabel: { fontSize: 6.5, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2, textAlign: "center" },

  equipCard: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, marginBottom: 12, overflow: "hidden" },
  equipHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 12 },
  equipName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#0F172A" },
  equipSub: { fontSize: 8, color: "#64748B", marginTop: 1 },
  equipStatusPill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  equipBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 },
  label: { fontSize: 7, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 3, fontFamily: "Helvetica-Bold" },
  obs: { fontSize: 9.5, color: "#334155", lineHeight: 1.5 },
  recRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 3 },
  recBadge: { paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 8, fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  recText: { flex: 1, fontSize: 9, color: "#334155" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { backgroundColor: "#ECFDF5", color: "#047857", borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6, fontSize: 7.5 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 4 },
  photo: { width: 110, height: 82, borderRadius: 4, objectFit: "cover" },

  acceptance: { marginTop: 16, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: "#ECFDF5", borderRadius: 8, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  signature: { width: 120, height: 54, objectFit: "contain", backgroundColor: "#FFFFFF", borderRadius: 4 },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#94A3B8", borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 8 },
});

type Item = {
  id: string;
  equipment_status: EquipmentStatus;
  observations_es: string | null;
  recommendations: Recommendation[];
  parts_replaced: { name: string; quantity?: number }[];
  checklist_items: string[];
  photo_paths: string[];
  equipment: { brand: string | null; model: string | null; custom_name: string; location_label: string | null } | null;
};

export type ReportPdfProps = {
  storageBase: string;
  serviceProvider: { name: string; logo_path: string | null };
  client: { name: string };
  location: { name: string; address: string | null } | null;
  report: {
    report_number: string;
    report_type: string;
    status: string;
    performed_at_start: string;
    performed_by_name: string | null;
    summary_es: string | null;
    trigger_event_es: string | null;
  };
  items: Item[];
  acceptance: { signed_by_name: string; signed_at: string; signature_path: string } | null;
};

const REPORT_TYPE_COLOR: Record<string, string> = {
  preventivo: "#3B82F6",
  correctivo: "#F97316",
  instalacion: "#10B981",
  inspeccion: "#64748B",
};

function pub(base: string, path: string): string {
  if (path.startsWith("http")) return path;
  return `${base}/storage/v1/object/public/cotiza-maintenance/${path}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PA", { day: "numeric", month: "long", year: "numeric" });
}

export function ReportPdf({ storageBase, serviceProvider, client, location, report, items, acceptance }: ReportPdfProps) {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.equipment_status] = (counts[it.equipment_status] ?? 0) + 1;
  const accent = REPORT_TYPE_COLOR[report.report_type] ?? "#3B82F6";
  const statusLabel = report.status === "accepted" ? "Aceptado" : report.status === "published" ? "Publicado" : "Borrador";
  const statusColor = report.status === "accepted" ? "#10B981" : report.status === "published" ? "#2563EB" : "#64748B";

  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        {/* Top bar */}
        <View style={s.topBar} fixed>
          <View style={s.brandRow}>
            {serviceProvider.logo_path ? (
              <Image style={s.logo} src={pub(storageBase, serviceProvider.logo_path)} />
            ) : null}
            <View>
              <Text style={s.brandName}>{serviceProvider.name}</Text>
              <Text style={s.brandTag}>Reporte de mantenimiento HVAC</Text>
            </View>
          </View>
          <View style={s.reportMeta}>
            <Text style={s.reportNumber}>{report.report_number}</Text>
            <Text style={{ ...s.statusPill, backgroundColor: statusColor }}>{statusLabel}</Text>
          </View>
        </View>

        {/* Hero */}
        <View style={s.heroCard}>
          <Text style={{ ...s.typeTag, backgroundColor: accent }}>
            {REPORT_TYPE_LABEL[report.report_type] ?? report.report_type}
          </Text>
          <Text style={s.clientName}>{client.name}</Text>
          {location ? (
            <Text style={s.metaLine}>
              {location.name}
              {location.address ? ` · ${location.address}` : ""}
            </Text>
          ) : null}
          <Text style={s.metaLine}>
            {fmtDate(report.performed_at_start)}
            {report.performed_by_name ? ` · Técnico: ${report.performed_by_name}` : ""}
          </Text>
          {report.trigger_event_es ? (
            <Text style={{ ...s.metaLine, color: "#B45309" }}>Evento: {report.trigger_event_es}</Text>
          ) : null}
        </View>

        {/* Summary */}
        {report.summary_es ? (
          <View>
            <Text style={s.sectionTitle}>Resumen</Text>
            <Text style={s.summaryBox}>{report.summary_es}</Text>
          </View>
        ) : null}

        {/* Counts */}
        {items.length > 0 ? (
          <View style={s.countsRow}>
            {(["operativo", "atencion", "critico", "fuera_de_servicio"] as const).map((st) => (
              <View key={st} style={s.countCard}>
                <Text style={{ ...s.countNum, color: STATUS_COLOR[st] }}>{counts[st] ?? 0}</Text>
                <Text style={s.countLabel}>{STATUS_LABEL[st]}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Equipment */}
        <Text style={s.sectionTitle}>Equipos inspeccionados ({items.length})</Text>
        {items.map((it) => {
          const color = STATUS_COLOR[it.equipment_status] ?? "#94A3B8";
          const eq = it.equipment;
          const title = eq?.location_label?.trim() || [eq?.brand, eq?.model].filter(Boolean).join(" ") || eq?.custom_name || "Equipo";
          const sub = [eq?.brand, eq?.model].filter(Boolean).join(" · ");
          return (
            <View key={it.id} style={s.equipCard} wrap={false}>
              <View style={{ ...s.equipHeader, backgroundColor: `${color}14` }}>
                <View>
                  <Text style={s.equipName}>{title}</Text>
                  {sub ? <Text style={s.equipSub}>{sub}</Text> : null}
                </View>
                <Text style={{ ...s.equipStatusPill, backgroundColor: color }}>
                  {STATUS_LABEL[it.equipment_status] ?? it.equipment_status}
                </Text>
              </View>
              <View style={s.equipBody}>
                {it.observations_es ? (
                  <>
                    <Text style={s.label}>Observaciones</Text>
                    <Text style={s.obs}>{it.observations_es}</Text>
                  </>
                ) : null}

                {it.recommendations.length > 0 ? (
                  <>
                    <Text style={s.label}>Recomendaciones</Text>
                    {it.recommendations.map((r, i) => (
                      <View key={i} style={s.recRow}>
                        <Text style={{ ...s.recBadge, backgroundColor: PRIORITY_COLOR[r.priority] ?? "#64748B" }}>
                          {PRIORITY_LABEL[r.priority] ?? r.priority}
                        </Text>
                        <Text style={s.recText}>{r.description}</Text>
                      </View>
                    ))}
                  </>
                ) : null}

                {it.parts_replaced.length > 0 ? (
                  <>
                    <Text style={s.label}>Partes reemplazadas</Text>
                    {it.parts_replaced.map((p, i) => (
                      <Text key={i} style={s.obs}>• {p.name}{p.quantity ? ` × ${p.quantity}` : ""}</Text>
                    ))}
                  </>
                ) : null}

                {it.checklist_items.length > 0 ? (
                  <>
                    <Text style={s.label}>Elementos revisados</Text>
                    <View style={s.chipRow}>
                      {it.checklist_items.map((c, i) => (
                        <Text key={i} style={s.chip}>{c}</Text>
                      ))}
                    </View>
                  </>
                ) : null}

                {it.photo_paths.length > 0 ? (
                  <>
                    <Text style={s.label}>Fotos</Text>
                    <View style={s.photoGrid}>
                      {it.photo_paths.slice(0, 6).map((p, i) => (
                        <Image key={i} style={s.photo} src={pub(storageBase, p)} />
                      ))}
                    </View>
                  </>
                ) : null}
              </View>
            </View>
          );
        })}

        {/* Acceptance */}
        {acceptance ? (
          <View style={s.acceptance} wrap={false}>
            <Image style={s.signature} src={pub(storageBase, acceptance.signature_path)} />
            <View>
              <Text style={{ fontSize: 8, color: "#047857", fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Aceptado por el cliente
              </Text>
              <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 }}>{acceptance.signed_by_name}</Text>
              <Text style={{ fontSize: 8, color: "#475569", marginTop: 1 }}>{fmtDate(acceptance.signed_at)}</Text>
            </View>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{serviceProvider.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
