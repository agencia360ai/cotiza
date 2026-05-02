import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#171717",
  },
  header: {
    marginBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingBottom: 16,
  },
  brand: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 10, color: "#737373" },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 9,
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 9,
    color: "#525252",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  colName: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1.5, textAlign: "right" },
  colTotal: { flex: 1.5, textAlign: "right" },
  itemReason: { fontSize: 8, color: "#737373", marginTop: 2, fontStyle: "italic" },
  totals: { marginTop: 16, marginLeft: "auto", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: "#737373" },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#171717",
    fontWeight: 700,
    fontSize: 12,
  },
  notes: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    fontSize: 9,
    color: "#525252",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#a3a3a3",
    textAlign: "center",
  },
});

type Item = {
  name: string;
  quantity: number;
  unit_price_usd: number;
  line_total_usd: number;
  ai_reasoning: string | null;
};

type Props = {
  org: { name: string };
  quote: {
    quote_number: string;
    subtotal_usd: number;
    tax_rate: number;
    tax_usd: number;
    total_usd: number;
    notes: string | null;
    created_at: string;
  };
  project: { name: string; client_name: string | null };
  items: Item[];
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function QuotePdf({ org, quote, project, items }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>{org.name}</Text>
          <Text style={styles.meta}>Cotización HVAC · {quote.quote_number}</Text>
          <Text style={styles.meta}>{new Date(quote.created_at).toLocaleDateString("es-PA")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Proyecto</Text>
          <Text style={{ fontSize: 12, fontWeight: 700 }}>{project.name}</Text>
          {project.client_name && <Text style={styles.meta}>Cliente: {project.client_name}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detalle de equipos</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colName}>Equipo</Text>
              <Text style={styles.colQty}>Cant.</Text>
              <Text style={styles.colUnit}>P. unit (USD)</Text>
              <Text style={styles.colTotal}>Total (USD)</Text>
            </View>
            {items.map((it, idx) => (
              <View key={idx} style={styles.tableRow}>
                <View style={styles.colName}>
                  <Text>{it.name}</Text>
                  {it.ai_reasoning && <Text style={styles.itemReason}>{it.ai_reasoning}</Text>}
                </View>
                <Text style={styles.colQty}>{it.quantity}</Text>
                <Text style={styles.colUnit}>{fmt(Number(it.unit_price_usd))}</Text>
                <Text style={styles.colTotal}>{fmt(Number(it.line_total_usd))}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text>USD {fmt(Number(quote.subtotal_usd))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>ITBMS ({(Number(quote.tax_rate) * 100).toFixed(0)}%)</Text>
            <Text>USD {fmt(Number(quote.tax_usd))}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>Total</Text>
            <Text>USD {fmt(Number(quote.total_usd))}</Text>
          </View>
        </View>

        {quote.notes && (
          <View style={styles.notes}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Text>{quote.notes}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Cotización generada con Cotiza · Precios en USD · ITBMS Panamá 7%
        </Text>
      </Page>
    </Document>
  );
}
