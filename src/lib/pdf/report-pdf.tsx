import { Document, Page, Text, View, Image, StyleSheet, Svg, Circle, Path } from "@react-pdf/renderer";
import type { EquipmentStatus, Recommendation } from "@/lib/maintenance/types";

const STATUS_COLOR: Record<string, string> = {
  operativo: "#10B981",
  atencion: "#F59E0B",
  critico: "#EF4444",
  fuera_de_servicio: "#64748B",
  sin_inspeccion: "#94A3B8",
};
const STATUS_LABEL: Record<string, string> = {
  operativo: "Operativo",
  atencion: "Requiere atención",
  critico: "Crítico",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};
const STATUS_LABEL_PLURAL: Record<string, string> = {
  operativo: "Operativos",
  atencion: "Atención",
  critico: "Críticos",
  fuera_de_servicio: "Fuera de servicio",
  sin_inspeccion: "Sin inspección",
};
const STATUS_WEIGHT: Record<string, number> = { operativo: 100, atencion: 60, critico: 20, fuera_de_servicio: 0, sin_inspeccion: 50 };
const REPORT_TITLE: Record<string, string> = {
  preventivo: "Reporte de Mantenimiento Preventivo",
  correctivo: "Reporte de Reparación Correctiva",
  instalacion: "Reporte de Nueva Instalación",
  inspeccion: "Reporte de Inspección",
};
const REPORT_TYPE_COLOR: Record<string, string> = { preventivo: "#3B82F6", correctivo: "#F97316", instalacion: "#10B981", inspeccion: "#64748B" };
const PRIORITY_COLOR: Record<string, string> = { alta: "#EF4444", media: "#F59E0B", baja: "#10B981" };
const PRIORITY_LABEL: Record<string, string> = { alta: "ALTA", media: "MEDIA", baja: "BAJA" };

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 52, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9.5, color: "#0F172A" },

  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 28, height: 28, borderRadius: 6, objectFit: "cover" },
  brandName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  brandTag: { fontSize: 7, color: "#94A3B8" },
  reportMeta: { alignItems: "flex-end" },
  reportNumber: { fontSize: 8, color: "#94A3B8" },
  statusPill: { marginTop: 3, paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 10, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },

  // Cover title
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 },
  title: { fontSize: 26, fontFamily: "Helvetica-Bold", lineHeight: 1.1, color: "#0F172A" },
  subtitle: { fontSize: 13, color: "#475569", marginTop: 2 },

  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 18, marginBottom: 20 },
  metaCell: { width: "50%", marginBottom: 10 },
  metaLabel: { fontSize: 7, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.6, fontFamily: "Helvetica-Bold" },
  metaValue: { fontSize: 11, color: "#0F172A", marginTop: 2 },

  // Summary + health
  summaryCard: { flexDirection: "row", gap: 16, borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", padding: 16, marginBottom: 22, alignItems: "center" },
  donutWrap: { position: "relative", width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  donutScore: { fontSize: 26, fontFamily: "Helvetica-Bold", color: "#0F172A" },
  donutScoreLabel: { fontSize: 6.5, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1 },
  summaryRight: { flex: 1 },
  summaryHeadline: { fontSize: 14, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  summaryText: { fontSize: 9.5, color: "#475569", lineHeight: 1.45, marginTop: 5 },

  sectionTitle: { fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "Helvetica-Bold" },

  // Cover equipment index
  idxRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  idxName: { flex: 1, fontSize: 10, color: "#0F172A", fontFamily: "Helvetica-Bold" },
  idxSub: { fontSize: 8, color: "#94A3B8", fontFamily: "Helvetica" },
  idxStatus: { fontSize: 8, fontFamily: "Helvetica-Bold" },

  // Detail
  detailHeader: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  detailSub: { fontSize: 9, color: "#94A3B8", marginBottom: 16 },

  card: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10, paddingHorizontal: 12 },
  equipName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  equipSub: { fontSize: 8, color: "#94A3B8", marginTop: 1 },
  statusPillSm: { paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 9, fontSize: 7, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12 },

  photoRow: { flexDirection: "row", gap: 4, marginBottom: 9 },
  photo: { width: 96, height: 72, borderRadius: 5, objectFit: "cover" },

  miniLabel: { fontSize: 6.5, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  doneChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ECFDF5", borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 6 },
  doneChipText: { fontSize: 7.5, color: "#047857" },
  partChip: { backgroundColor: "#EFF6FF", borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 6, fontSize: 7.5, color: "#1D4ED8" },

  block: { marginTop: 9 },
  obs: { fontSize: 9, color: "#475569", lineHeight: 1.4 },
  recRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 4 },
  recBadge: { paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 7, fontSize: 6, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  recText: { flex: 1, fontSize: 8.5, color: "#334155", lineHeight: 1.35 },
  okLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  okText: { fontSize: 9.5, color: "#047857", fontFamily: "Helvetica-Bold" },

  acceptance: { marginTop: 14, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: "#ECFDF5", borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  signature: { width: 110, height: 50, objectFit: "contain", backgroundColor: "#FFFFFF", borderRadius: 4 },

  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#94A3B8", borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 7 },
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
function equipTitle(eq: Item["equipment"]): string {
  return eq?.location_label?.trim() || [eq?.brand, eq?.model].filter(Boolean).join(" ") || eq?.custom_name || "Equipo";
}
function equipSub(eq: Item["equipment"]): string {
  return [eq?.brand, eq?.model].filter(Boolean).join(" · ");
}

function CheckMark({ size = 15, bg = "#10B981" }: { size?: number; bg?: string }) {
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={r} cy={r} r={r} fill={bg} />
      <Path d={`M ${size * 0.27} ${size * 0.52} L ${size * 0.43} ${size * 0.68} L ${size * 0.74} ${size * 0.33}`} stroke="#FFFFFF" strokeWidth={size * 0.11} fill="none" />
    </Svg>
  );
}

function StatusMark({ status, size = 15 }: { status: string; size?: number }) {
  if (status === "operativo") return <CheckMark size={size} bg={STATUS_COLOR.operativo} />;
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={r} cy={r} r={r} fill={STATUS_COLOR[status] ?? "#94A3B8"} />
      <Path d={`M ${r} ${size * 0.28} L ${r} ${size * 0.58}`} stroke="#FFFFFF" strokeWidth={size * 0.12} fill="none" />
      <Circle cx={r} cy={size * 0.72} r={size * 0.07} fill="#FFFFFF" />
    </Svg>
  );
}

function StatusDonut({ counts, total }: { counts: Record<string, number>; total: number }) {
  const size = 110;
  const thickness = 14;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const order = ["operativo", "atencion", "critico", "fuera_de_servicio", "sin_inspeccion"];
  const present = order.filter((st) => (counts[st] ?? 0) > 0);

  if (present.length <= 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
        {present.length === 1 ? (
          <Circle cx={cx} cy={cy} r={r} fill="none" stroke={STATUS_COLOR[present[0]]} strokeWidth={thickness} />
        ) : null}
      </Svg>
    );
  }

  let accFrac = 0;
  const segs = present.map((st) => {
    const frac = (counts[st] ?? 0) / total;
    const dash = Math.max(frac * C - 1.5, 0.5);
    const startAngle = accFrac * 360 - 90;
    const el = (
      <Circle key={st} cx={cx} cy={cy} r={r} fill="none" stroke={STATUS_COLOR[st]} strokeWidth={thickness}
        strokeDasharray={`${dash} ${C - dash}`} transform={`rotate(${startAngle}, ${cx}, ${cy})`} />
    );
    accFrac += frac;
    return el;
  });
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
      {segs}
    </Svg>
  );
}

export function ReportPdf({ storageBase, serviceProvider, client, location, report, items, acceptance }: ReportPdfProps) {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.equipment_status] = (counts[it.equipment_status] ?? 0) + 1;
  const total = items.length;
  const operativos = counts.operativo ?? 0;
  const issues = total - operativos;
  const weighted = items.reduce((sum, it) => sum + (STATUS_WEIGHT[it.equipment_status] ?? 50), 0);
  const score = total > 0 ? Math.round(weighted / total) : 0;
  const accent = REPORT_TYPE_COLOR[report.report_type] ?? "#3B82F6";
  const statusLabel = report.status === "accepted" ? "Aceptado" : report.status === "published" ? "Publicado" : "Borrador";
  const statusColor = report.status === "accepted" ? "#10B981" : report.status === "published" ? "#2563EB" : "#64748B";
  const headline = total === 0
    ? "Sin equipos inspeccionados"
    : issues === 0
      ? `Todos los equipos operativos (${total})`
      : `${operativos} de ${total} operativos · ${issues} requieren acción`;

  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.topBar} fixed>
          <View style={s.brandRow}>
            {serviceProvider.logo_path ? <Image style={s.logo} src={pub(storageBase, serviceProvider.logo_path)} /> : null}
            <View>
              <Text style={s.brandName}>{serviceProvider.name}</Text>
              <Text style={s.brandTag}>Servicio técnico HVAC</Text>
            </View>
          </View>
          <View style={s.reportMeta}>
            <Text style={s.reportNumber}>{report.report_number}</Text>
            <Text style={{ ...s.statusPill, backgroundColor: statusColor }}>{statusLabel}</Text>
          </View>
        </View>

        {/* COVER */}
        <Text style={{ ...s.kicker, color: accent }}>{report.report_type === "correctivo" ? "Servicio correctivo" : "Servicio HVAC"}</Text>
        <Text style={s.title}>{REPORT_TITLE[report.report_type] ?? "Reporte de Mantenimiento"}</Text>
        <Text style={s.subtitle}>Sistema de aire acondicionado y refrigeración</Text>

        <View style={s.metaGrid}>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>Cliente</Text>
            <Text style={s.metaValue}>{client.name}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>Fecha</Text>
            <Text style={s.metaValue}>{fmtDate(report.performed_at_start)}</Text>
          </View>
          {location ? (
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>Sucursal</Text>
              <Text style={s.metaValue}>{location.name}</Text>
            </View>
          ) : null}
          {report.performed_by_name ? (
            <View style={s.metaCell}>
              <Text style={s.metaLabel}>Técnico</Text>
              <Text style={s.metaValue}>{report.performed_by_name}</Text>
            </View>
          ) : null}
        </View>

        {/* Resumen + salud */}
        <View style={s.summaryCard}>
          <View style={s.donutWrap}>
            <StatusDonut counts={counts} total={Math.max(total, 1)} />
            <View style={s.donutCenter}>
              <Text style={s.donutScore}>{score}%</Text>
              <Text style={s.donutScoreLabel}>Salud</Text>
            </View>
          </View>
          <View style={s.summaryRight}>
            <Text style={{ ...s.summaryHeadline, color: issues === 0 ? "#047857" : "#0F172A" }}>{headline}</Text>
            {report.summary_es ? <Text style={s.summaryText}>{report.summary_es}</Text> : null}
            {report.trigger_event_es ? <Text style={{ ...s.summaryText, color: "#B45309" }}>Evento: {report.trigger_event_es}</Text> : null}
          </View>
        </View>

        {/* Índice de equipos */}
        <Text style={s.sectionTitle}>Equipos atendidos ({total})</Text>
        {items.map((it) => {
          const color = STATUS_COLOR[it.equipment_status] ?? "#94A3B8";
          return (
            <View key={it.id} style={s.idxRow} wrap={false}>
              <StatusMark status={it.equipment_status} size={14} />
              <Text style={s.idxName}>
                {equipTitle(it.equipment)}
                {equipSub(it.equipment) ? <Text style={s.idxSub}>{"  "}{equipSub(it.equipment)}</Text> : null}
              </Text>
              <Text style={{ ...s.idxStatus, color }}>{(STATUS_LABEL_PLURAL[it.equipment_status] ?? it.equipment_status).toUpperCase()}</Text>
            </View>
          );
        })}

        {/* DETALLE — empieza en página nueva */}
        <View break>
          <Text style={s.detailHeader}>Detalle por equipo</Text>
          <Text style={s.detailSub}>Estado, trabajo realizado y recomendaciones de cada equipo</Text>

          {items.map((it) => {
            const color = STATUS_COLOR[it.equipment_status] ?? "#94A3B8";
            const isOk = it.equipment_status === "operativo";
            const hasRecs = it.recommendations.length > 0;
            return (
              <View key={it.id} style={s.card} wrap={false}>
                <View style={{ ...s.cardTop, backgroundColor: `${color}12` }}>
                  <StatusMark status={it.equipment_status} size={18} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.equipName}>{equipTitle(it.equipment)}</Text>
                    {equipSub(it.equipment) ? <Text style={s.equipSub}>{equipSub(it.equipment)}</Text> : null}
                  </View>
                  <Text style={{ ...s.statusPillSm, backgroundColor: color }}>
                    {(STATUS_LABEL[it.equipment_status] ?? it.equipment_status).toUpperCase()}
                  </Text>
                </View>

                <View style={s.cardBody}>
                  {it.photo_paths.length > 0 ? (
                    <View style={s.photoRow}>
                      {it.photo_paths.slice(0, 4).map((p, i) => (
                        <Image key={i} style={s.photo} src={pub(storageBase, p)} />
                      ))}
                    </View>
                  ) : null}

                  {/* OK visual cuando está operativo y sin recomendaciones */}
                  {isOk && !hasRecs ? (
                    <View style={s.okLine}>
                      <CheckMark size={14} />
                      <Text style={s.okText}>Funcionamiento normal — sin novedades</Text>
                    </View>
                  ) : null}

                  {it.checklist_items.length > 0 ? (
                    <View style={s.block}>
                      <Text style={s.miniLabel}>Revisado</Text>
                      <View style={s.chipWrap}>
                        {it.checklist_items.map((c, i) => (
                          <View key={i} style={s.doneChip}>
                            <CheckMark size={8} />
                            <Text style={s.doneChipText}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {it.parts_replaced.length > 0 ? (
                    <View style={s.block}>
                      <Text style={s.miniLabel}>Reemplazado</Text>
                      <View style={s.chipWrap}>
                        {it.parts_replaced.map((p, i) => (
                          <Text key={i} style={s.partChip}>{p.name}{p.quantity ? ` ×${p.quantity}` : ""}</Text>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {/* Recomendaciones — solo si hay */}
                  {hasRecs ? (
                    <View style={s.block}>
                      <Text style={s.miniLabel}>Acción recomendada</Text>
                      {it.recommendations.map((r, i) => (
                        <View key={i} style={s.recRow}>
                          <Text style={{ ...s.recBadge, backgroundColor: PRIORITY_COLOR[r.priority] ?? "#64748B" }}>
                            {PRIORITY_LABEL[r.priority] ?? r.priority}
                          </Text>
                          <Text style={s.recText}>{r.description}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* Observación — solo si aporta y no es operativo trivial */}
                  {it.observations_es && !(isOk && !hasRecs) ? (
                    <View style={s.block}>
                      <Text style={s.miniLabel}>Observaciones</Text>
                      <Text style={s.obs}>{it.observations_es}</Text>
                    </View>
                  ) : null}
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
        </View>

        <View style={s.footer} fixed>
          <Text>{serviceProvider.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
