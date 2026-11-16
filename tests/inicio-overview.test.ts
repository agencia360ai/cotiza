import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterProjects,
  monthlySeries,
  overviewProject,
  summarizeProjects,
} from "../src/lib/inicio/overview";
import type { QboProject } from "../src/lib/quickbooks/projects";

function project(change: Partial<QboProject> = {}): QboProject {
  return {
    id: "1",
    name: "DC26-01 Instalación",
    fullName: "DC26-01 Instalación",
    clientName: "Cliente de prueba",
    parentId: null,
    siblings: 1,
    rubro: "DC",
    year: 2026,
    income: 1000,
    paid: 1000,
    cost: 600,
    margin: 0.4,
    closed: false,
    status: "activo",
    progress: null,
    startDate: null,
    endDate: null,
    contractTotal: null,
    quoteNumber: null,
    qboCreatedAt: null,
    firstTxnDate: null,
    lastTxnDate: null,
    txnDatesSource: null,
    meses: [{ month: "2026-01-01", income: 1000, cost: 600 }],
    horas: null,
    porFacturar: null,
    cobros: [{ month: "2026-01-01", facturado: 1070, cobrado: 535 }],
    ...change,
  };
}

test("cash uses payments including tax and advances; receivables use actual balances, not project status", () => {
  const p = overviewProject(
    project({
      status: "cerrado",
      porFacturar: { neto: 200, cobrado: 100, docs: [] },
    }),
  );
  assert.equal(p.collected, 635);
  assert.equal(p.receivable, 535);
  assert.equal(p.income, 1000);
  assert.equal(p.profit, 400);
  assert.equal(filterProjects([p], "collect").length, 1);
});

test("missing payment breakdown never substitutes the legacy paid field or pretends the balance is zero", () => {
  const p = overviewProject(project({ cobros: null, paid: 1000 }));
  assert.equal(p.collected, null);
  assert.equal(p.receivable, null);
  assert.equal(summarizeProjects([p]).collected, null);
  assert.equal(summarizeProjects([p]).missingCash, 1);
});

test("known advances remain visible with a partial cash warning when invoice payments are unknown", () => {
  const p = overviewProject(
    project({
      cobros: null,
      porFacturar: { neto: 200, cobrado: 100, docs: [] },
    }),
  );
  const summary = summarizeProjects([p]);
  assert.equal(summary.collected, 100);
  assert.equal(summary.receivable, null);
  assert.equal(summary.missingCash, 1);
});

test("credit-adjusted invoices with zero real payments do not increase cash received", () => {
  const p = overviewProject(
    project({
      paid: 9600,
      cobros: [{ month: "2026-02-01", facturado: 9600, cobrado: 0 }],
    }),
  );
  assert.equal(p.collected, 0);
  assert.equal(p.receivable, 9600);
});

test("loss includes technician costs and is not replaced with the stored margin", () => {
  const p = overviewProject(
    project({
      cost: 950,
      margin: 0.5,
      horas: {
        costo: 200,
        horas: 10,
        sinTarifa: 0,
        meses: [{ month: "2026-01-01", costo: 200 }],
        tecnicos: [],
      },
    }),
  );
  assert.equal(p.cost, 1150);
  assert.equal(p.profit, -150);
  assert.equal(p.margin, -0.15);
  assert.equal(filterProjects([p], "review").length, 1);
  assert.equal(monthlySeries([p], 2026)[0].cost, 800);
});

test("unknown, negative and not-yet-entered costs do not produce a fictitious positive margin", () => {
  for (const cost of [null, -10, 0]) {
    const p = overviewProject(project({ cost }));
    assert.equal(p.profit, null);
    assert.equal(p.margin, null);
    assert.equal(filterProjects([p], "missing").length, 1);
  }
});

test("partial profitability compares matching projects; genuine zero revenue costs still count as a loss", () => {
  const summary = summarizeProjects([
    overviewProject(project()),
    overviewProject(project({ id: "2", income: 10000, cost: null })),
    overviewProject(project({ id: "3", income: 0, cost: 500 })),
  ]);
  assert.equal(summary.income, 11000);
  assert.equal(summary.profit, -100);
  assert.equal(summary.margin, -0.1);
  assert.equal(summary.missingProfit, 1);
});

test("no projects and missing breakdowns are distinct from confirmed zeros", () => {
  assert.equal(summarizeProjects([]).income, null);
  assert.equal(summarizeProjects([]).profit, null);
  const p = overviewProject(
    project({ income: 0, cost: 0, cobros: [], meses: [] }),
  );
  assert.equal(summarizeProjects([p]).collected, 0);
  assert.equal(summarizeProjects([p]).receivable, 0);
  assert.equal(summarizeProjects([p]).profit, 0);
  assert.equal(monthlySeries([p], 2026)[0].reported, false);
});

test("monthly series respects years, signed adjustments, and reported zero months", () => {
  const p = overviewProject(
    project({
      meses: [
        { month: "2025-12-01", income: 9900, cost: 5000 },
        { month: "2026-01-01", income: 0, cost: 0 },
        { month: "2026-02-01", income: -100, cost: -20 },
      ],
    }),
  );
  const months = monthlySeries([p], 2026);
  assert.equal(months[0].reported, true);
  assert.equal(months[1].income, -100);
  assert.equal(months[1].cost, -20);
  assert.equal(months[11].reported, false);
});

test("search ignores accents and the priority list puts the largest balance first", () => {
  const a = overviewProject(project());
  const b = overviewProject(
    project({
      id: "2",
      cobros: [{ month: "2026-01-01", facturado: 3000, cobrado: 0 }],
    }),
  );
  assert.deepEqual(
    filterProjects([a, b], "collect", "instalacion").map((p) => p.id),
    ["2", "1"],
  );
  assert.equal(filterProjects([a, b], "all", "no existe").length, 0);
});
