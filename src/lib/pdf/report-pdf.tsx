import { Document, Page, Text, View, Image, StyleSheet, Svg, Circle, Rect } from "@react-pdf/renderer";
import type { EquipmentStatus, Recommendation } from "@/lib/maintenance/types";

const STATUS_COLOR: Record<string, string> = {
  operativo: "#10B981",
  atencion: "#F59E0B",
  critico: "#EF4444",
  fuera_de_servicio: "#64748B",
  sin_inspeccion: "#94A3B8",
};
const STATUS_LABEL: Record<string, string> = {
  operativo: "Operativos",
  atencion: "Atención",
  critico: "Críticos",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};
const STATUS_WEIGHT: Record<string, number> = {
  operativo: 100,
  atencion: 60,
  critico: 20,
  fuera_de_servicio: 0,
  sin_inspeccion: 50,
};
const REPORT_TYPE_LABEL: Record<string, string> = {
  preventivo: "Mantenimiento Preventivo",
  correctivo: "Reparación Correctiva",
  instalacion: "Nueva Instalación",
  inspeccion: "Inspección",
};
const REPORT_TYPE_COLOR: Record<string, string> = {
  preventivo: "#3B82F6",
  correctivo: "#F97316",
  instalacion: "#10B981",
  inspeccion: "#64748B",
};
const PRIORITY_COLOR: Record<string, string> = { alta: "#EF4444", media: "#F59E0B", baja: "#10B981" };
const PRIORITY_LABEL: Record<string, string> = { alta: "ALTA", media: "MEDIA", baja: "BAJA" };

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 52, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9.5, color: "#0F172A" },

  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 6, objectFit: "cover" },
  brandName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  brandTag: { fontSize: 7.5, color: "#94A3B8" },
  reportMeta: { alignItems: "flex-end" },
  reportNumber: { fontSize: 8, color: "#94A3B8" },
  statusPill: { marginTop: 3, paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 10, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },

  // Dashboard hero
  hero: { flexDirection: "row", borderRadius: 12, overflow: "hidden", marginBottom: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  heroLeft: { width: 200, backgroundColor: "#0F172A", padding: 18, justifyContent: "center", alignItems: "center" },
  heroRight: { flex: 1, padding: 18 },
  typeTag: { alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 },
  clientName: { fontSize: 19, fontFamily: "Helvetica-Bold", lineHeight: 1.1 },
  metaLine: { fontSize: 9, color: "#475569", marginTop: 4 },

  donutWrap: { position: "relative", width: 130, height: 130, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center", justifyContent: "center", top: 0, bottom: 0, left: 0, right: 0 },
  donutScore: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  donutScoreLabel: { fontSize: 7, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginTop: -2 },
  heroEquipTotal: { fontSize: 8, color: "#CBD5E1", marginTop: 8 },

  legendRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 8.5, color: "#334155", flex: 1 },
  legendCount: { fontSize: 8.5, fontFamily: "Helvetica-Bold" },

  // Stat tiles
  tilesRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tile: { flex: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  tileNum: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  tileLabel: { fontSize: 6.5, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2, textAlign: "center" },

  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F8FAFC", borderRadius: 8, padding: 11, marginBottom: 16 },
  summaryBar: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#2563EB" },
  summaryText: { flex: 1, fontSize: 9.5, color: "#334155", lineHeight: 1.45 },

  sectionTitle: { fontSize: 8.5, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontFamily: "Helvetica-Bold" },

  // Equipment card
  card: { flexDirection: "row", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, marginBottom: 10, overflow: "hidden" },
  cardAccent: { width: 5 },
  cardBody: { flex: 1, padding: 11 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  equipName: { fontSize: 11.5, fontFamily: "Helvetica-Bold" },
  equipSub: { fontSize: 8, color: "#94A3B8", marginTop: 1 },
  statusPillSm: { paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 9, fontSize: 7, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },

  obs: { fontSize: 9, color: "#475569", lineHeight: 1.4, marginTop: 6 },

  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 7, alignItems: "center" },
  miniLabel: { fontSize: 6.5, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.4, fontFamily: "Helvetica-Bold", marginRight: 2 },
  doneChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ECFDF5", borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 6 },
  doneDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#10B981" },
  doneChipText: { fontSize: 7.5, color: "#047857" },
  partChip: { backgroundColor: "#EFF6FF", borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 6, fontSize: 7.5, color: "#1D4ED8" },

  recRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 4 },
  recBadge: { paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 7, fontSize: 6, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  recText: { flex: 1, fontSize: 8.5, color: "#475569", lineHeight: 1.35 },

  photoRow: { flexDirection: "row", gap: 4, marginTop: 8 },
  photo: { width: 86, height: 64, borderRadius: 5, objectFit: "cover" },

  acceptance: { marginTop: 14, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: "#ECFDF5", borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  signature: { width: 110, height: 50, objectFit: "contain", backgroundColor: "#FFFFFF", borderRadius: 4 },

  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#94A3B8", borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 7 },
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

function pub(base: string, path: string): string {
  if (path.startsWith("http")) return path;
  return `${base}/storage/v1/object/public/cotiza-maintenance/${path}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PA", { day: "numeric", month: "long", year: "numeric" });
}

function StatusDonut({ counts, total }: { counts: Record<string, number>; total: number }) {
  const size = 130;
  const thickness = 16;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const order = ["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"];
  const present = order.filter((st) => (counts[st] ?? 0) > 0);

  // Single status (100%): draw a full ring. A dash gap of 0 crashes @react-pdf.
  if (present.length <= 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#1E293B" strokeWidth={thickness} />
        {present.length === 1 ? (
          <Circle cx={cx} cy={cy} r={r} fill="none" stroke={STATUS_COLOR[present[0]]} strokeWidth={thickness} />
        ) : null}
      </Svg>
    );
  }

  let accFrac = 0;
  const segs = present.map((st) => {
    const frac = (counts[st] ?? 0) / total;
    // Small gap between segments, never let the dash equal the full circumference.
    const dash = Math.max(frac * C - 1.5, 0.5);
    const startAngle = accFrac * 360 - 90;
    const el = (
      <Circle
        key={st}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={STATUS_COLOR[st]}
        strokeWidth={thickness}
        strokeDasharray={`${dash} ${C - dash}`}
        transform={`rotate(${startAngle}, ${cx}, ${cy})`}
      />
    );
    accFrac += frac;
    return el;
  });

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#1E293B" strokeWidth={thickness} />
      {segs}
    </Svg>
  );
}

export function ReportPdf({ storageBase, serviceProvider, client, location, report, items, acceptance }: ReportPdfProps) {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.equipment_status] = (counts[it.equipment_status] ?? 0) + 1;
  const total = items.length;

  const weighted = items.reduce((sum, it) => sum + (STATUS_WEIGHT[it.equipment_status] ?? 50), 0);
  const score = total > 0 ? Math.round(weighted / total) : 0;

  const accent = REPORT_TYPE_COLOR[report.report_type] ?? "#3B82F6";
  const statusLabel = report.status === "accepted" ? "Aceptado" : report.status === "published" ? "Publicado" : "Borrador";
  const statusColor = report.status === "accepted" ? "#10B981" : report.status === "published" ? "#2563EB" : "#64748B";

  const tiles = [
    { st: "operativo", n: counts.operativo ?? 0 },
    { st: "atencion", n: counts.atencion ?? 0 },
    { st: "critico", n: counts.critico ?? 0 },
    { st: "fuera_de_servicio", n: counts.fuera_de_servicio ?? 0 },
  ];

  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.topBar} fixed>
          <View style={s.brandRow}>
            {serviceProvider.logo_path ? <Image style={s.logo} src={pub(storageBase, serviceProvider.logo_path)} /> : null}
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

        {/* Dashboard hero */}
        <View style={s.hero}>
          <View style={s.heroLeft}>
            <View style={s.donutWrap}>
              <StatusDonut counts={counts} total={Math.max(total, 1)} />
              <View style={s.donutCenter}>
                <Text style={s.donutScore}>{score}%</Text>
                <Text style={s.donutScoreLabel}>Salud</Text>
              </View>
            </View>
            <Text style={s.heroEquipTotal}>{total} equipo{total === 1 ? "" : "s"} inspeccionado{total === 1 ? "" : "s"}</Text>
          </View>
          <View style={s.heroRight}>
            <Text style={{ ...s.typeTag, backgroundColor: accent }}>{REPORT_TYPE_LABEL[report.report_type] ?? report.report_type}</Text>
            <Text style={s.clientName}>{client.name}</Text>
            {location ? <Text style={s.metaLine}>{location.name}{location.address ? ` · ${location.address}` : ""}</Text> : null}
            <Text style={s.metaLine}>{fmtDate(report.performed_at_start)}{report.performed_by_name ? ` · ${report.performed_by_name}` : ""}</Text>
            {report.trigger_event_es ? <Text style={{ ...s.metaLine, color: "#B45309" }}>⚠ {report.trigger_event_es}</Text> : null}

            {(["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"] as const)
              .filter((st) => (counts[st] ?? 0) > 0)
              .map((st) => (
                <View key={st} style={s.legendRow}>
                  <View style={{ ...s.legendDot, backgroundColor: STATUS_COLOR[st] }} />
                  <Text style={s.legendLabel}>{STATUS_LABEL[st]}</Text>
                  <Text style={{ ...s.legendCount, color: STATUS_COLOR[st] }}>{counts[st]}</Text>
                </View>
              ))}
          </View>
        </View>

        {/* Stat tiles */}
        {total > 0 ? (
          <View style={s.tilesRow}>
            {tiles.map((t) => (
              <View key={t.st} style={{ ...s.tile, backgroundColor: `${STATUS_COLOR[t.st]}15` }}>
                <Text style={{ ...s.tileNum, color: STATUS_COLOR[t.st] }}>{t.n}</Text>
                <Text style={{ ...s.tileLabel, color: STATUS_COLOR[t.st] }}>{STATUS_LABEL[t.st]}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Summary (kept short, de-emphasized) */}
        {report.summary_es ? (
          <View style={s.summaryRow}>
            <View style={s.summaryBar} />
            <Text style={s.summaryText}>{report.summary_es}</Text>
          </View>
        ) : null}

        {/* Equipment cards — visual, photo-forward */}
        <Text style={s.sectionTitle}>Trabajo realizado por equipo</Text>
        {items.map((it) => {
          const color = STATUS_COLOR[it.equipment_status] ?? "#94A3B8";
          const eq = it.equipment;
          const title = eq?.location_label?.trim() || [eq?.brand, eq?.model].filter(Boolean).join(" ") || eq?.custom_name || "Equipo";
          const sub = [eq?.brand, eq?.model].filter(Boolean).join(" · ");
          return (
            <View key={it.id} style={s.card} wrap={false}>
              <View style={{ ...s.cardAccent, backgroundColor: color }} />
              <View style={s.cardBody}>
                <View style={s.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.equipName}>{title}</Text>
                    {sub ? <Text style={s.equipSub}>{sub}</Text> : null}
                  </View>
                  <Text style={{ ...s.statusPillSm, backgroundColor: color }}>
                    {(STATUS_LABEL[it.equipment_status] ?? it.equipment_status).toUpperCase()}
                  </Text>
                </View>

                {/* Photos first — the visual proof */}
                {it.photo_paths.length > 0 ? (
                  <View style={s.photoRow}>
                    {it.photo_paths.slice(0, 5).map((p, i) => (
                      <Image key={i} style={s.photo} src={pub(storageBase, p)} />
                    ))}
                  </View>
                ) : null}

                {/* What was done: checklist + parts as chips */}
                {it.checklist_items.length > 0 ? (
                  <View style={s.badgeRow}>
                    <Text style={s.miniLabel}>Revisado</Text>
                    {it.checklist_items.map((c, i) => (
                      <View key={i} style={s.doneChip}>
                        <View style={s.doneDot} />
                        <Text style={s.doneChipText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {it.parts_replaced.length > 0 ? (
                  <View style={s.badgeRow}>
                    <Text style={s.miniLabel}>Reemplazado</Text>
                    {it.parts_replaced.map((p, i) => (
                      <Text key={i} style={s.partChip}>
                        {p.name}{p.quantity ? ` ×${p.quantity}` : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {/* Short observation */}
                {it.observations_es ? <Text style={s.obs}>{it.observations_es}</Text> : null}

                {/* Recommendations as priority badges */}
                {it.recommendations.map((r, i) => (
                  <View key={i} style={s.recRow}>
                    <Text style={{ ...s.recBadge, backgroundColor: PRIORITY_COLOR[r.priority] ?? "#64748B" }}>
                      {PRIORITY_LABEL[r.priority] ?? r.priority}
                    </Text>
                    <Text style={s.recText}>{r.description}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        {acceptance ? (
          <View style={s.acceptance} wrap={false}>
            <Image style={s.signature} src={pub(storageBase, acceptance.signature_path)} />
            <View>
              <Text style={{ fontSize: 7.5, color: "#047857", fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5 }}>
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

void Rect;
