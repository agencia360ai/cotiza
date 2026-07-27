import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/org-context";
import { fechaLarga, fmtBal, letterTotals, resolveTextos, type LetterData } from "@/lib/quotes/letter";
import { CartaControls } from "./carta-controls";

export const dynamic = "force-dynamic";

type QuoteForLetter = {
  quote_number: string;
  sent_date: string | null;
  client_name: string | null;
  description: string | null;
  amount_usd: number | null;
  letter: LetterData | null;
  client: { name: string } | null;
  location: { name: string } | null;
};

export default async function CartaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/onboarding");

  const run = (cols: string) =>
    supabase.from("sales_quotes").select(cols).eq("id", id).eq("org_id", orgId).maybeSingle();
  let res = (await run(
    "quote_number, sent_date, client_name, description, amount_usd, letter, client:clients(name), location:client_locations(name)",
  )) as { data: QuoteForLetter | null; error: { message: string } | null };
  if (res.error) {
    // Migración 0008 pendiente: sin la columna letter.
    res = (await run(
      "quote_number, sent_date, client_name, description, amount_usd, client:clients(name), location:client_locations(name)",
    )) as { data: QuoteForLetter | null; error: { message: string } | null };
  }
  const q = res.data;
  if (!q) notFound();

  const letter: LetterData =
    q.letter ?? {
      fecha: q.sent_date ?? new Date().toISOString().slice(0, 10),
      ubicacion: q.location?.name ?? null,
      tipo: "realizar",
      items: [{ cant: 1, desc: q.description ?? "Trabajos según cotización", precio: q.amount_usd ?? 0 }],
      aplica_itbms: false,
      tasa: 7,
      validez: null,
      condiciones: null,
      elaborado: null,
    };
  const cliente = q.client?.name ?? q.client_name ?? "Cliente";
  const { subtotal, itbms, total } = letterTotals(letter);
  const T = resolveTextos(letter, { quoteNumber: q.quote_number });

  // Firma seleccionada (best-effort: sin la 0036 o si se borró, va sin firma).
  let firmaUrl: string | null = null;
  if (letter.firma?.id) {
    const { data: sig } = (await supabase
      .from("quote_signatures")
      .select("data_url")
      .eq("id", letter.firma.id)
      .eq("org_id", orgId)
      .maybeSingle()) as { data: { data_url: string } | null };
    firmaUrl = sig?.data_url ?? null;
  }

  return (
    <div className="min-h-screen bg-slate-200 px-4 py-6 print:bg-white print:p-0">
      {/* print setup: carta completa con membrete a sangre */}
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: 8.5in !important; min-height: 11in !important; }
        }
      `}</style>
      <CartaControls />

      <div
        className="sheet relative mx-auto w-[8.5in] min-h-[11in] bg-white text-[13px] leading-relaxed text-slate-900 shadow-xl"
        style={{
          backgroundImage: "url(/dicec-membrete.png)",
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="px-[1in] pb-[1.1in] pt-[1.55in]">
          <div className="text-right">{fechaLarga(letter.fecha)}</div>

          <div className="mt-6 font-semibold">
            {cliente}
            {letter.ubicacion ? (
              <>
                <br />
                <span className="font-normal">{letter.ubicacion}</span>
              </>
            ) : null}
            {T.saludo ? (
              <>
                <br />
                <span className="font-normal">{T.saludo}</span>
              </>
            ) : null}
          </div>

          {T.ref_label || T.ref_texto ? (
            <div className="mt-5">
              {T.ref_label ? (
                <>
                  <u>{T.ref_label}</u>:{" "}
                </>
              ) : null}
              <b>{T.ref_texto}</b>
            </div>
          ) : null}

          {T.intro ? <p className="mt-4">{T.intro}</p> : null}

          <table className="mt-4 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="w-[0.7in] py-1.5 pr-2 font-semibold">{T.th_cant}</th>
                <th className="py-1.5 pr-2 font-semibold">{T.th_desc}</th>
                <th className="w-[1.1in] py-1.5 pr-2 text-right font-semibold">{T.th_precio}</th>
                <th className="w-[1.1in] py-1.5 text-right font-semibold">{T.th_total}</th>
              </tr>
            </thead>
            <tbody>
              {letter.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{it.cant}</td>
                  <td className="py-1.5 pr-2">{it.desc}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">B/. {fmtBal(it.precio)}</td>
                  <td className="py-1.5 text-right tabular-nums">B/. {fmtBal(it.cant * it.precio)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto mt-3 w-[3.2in] text-[12.5px]">
            <div className="flex justify-between py-0.5">
              <span>{T.lbl_subtotal}</span>
              <span className="tabular-nums">B/. {fmtBal(subtotal)}</span>
            </div>
            {letter.aplica_itbms ? (
              <div className="flex justify-between py-0.5">
                <span>{T.lbl_itbms}</span>
                <span className="tabular-nums">B/. {fmtBal(itbms)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t-2 border-slate-800 py-1 font-semibold">
              <span>{T.lbl_total}</span>
              <span className="tabular-nums">B/. {fmtBal(total)}</span>
            </div>
          </div>

          {T.oferta ? (
            <p className="mt-6">
              {T.oferta} <i className="font-semibold">B/. {fmtBal(total)}</i>
            </p>
          ) : null}

          {T.validez_texto || letter.condiciones ? (
            <div className="mt-3 space-y-1">
              {T.validez_texto ? <div>{T.validez_texto}</div> : null}
              {letter.condiciones
                ? letter.condiciones.split("\n").map((ln, i) => (ln.trim() ? <div key={i}>{ln}</div> : null))
                : null}
            </div>
          ) : null}

          {letter.elaborado ? (
            <div className="mt-14">
              <div className="w-[2.6in] border-t border-slate-800 pt-1">
                {letter.elaborado}
                {T.empresa ? (
                  <>
                    <br />
                    {T.empresa}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Firma: posicionada libremente en fracciones de la hoja (mismo
            sistema que el PDF, por eso coinciden). */}
        {letter.firma && firmaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firmaUrl}
            alt="Firma"
            className="pointer-events-none absolute"
            style={{
              left: `${letter.firma.x * 100}%`,
              top: `${letter.firma.y * 100}%`,
              width: `${letter.firma.w * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
