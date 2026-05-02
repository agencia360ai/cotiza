import type { ProjectExtraction } from "./types";

export type Gap = {
  field: string;
  label: string;
  priority: "critical" | "helpful";
  inputType: "number" | "text" | "choice";
  options?: string[];
};

// Deterministic rules for what's CRITICAL to have before generating a quote.
// Keeps cost low (no AI call) and behavior predictable.
export function identifyGaps(extraction: Partial<ProjectExtraction>): Gap[] {
  const gaps: Gap[] = [];

  if (!extraction.building_type) {
    gaps.push({
      field: "building_type",
      label: "¿Qué tipo de edificación es?",
      priority: "critical",
      inputType: "choice",
      options: ["residential", "commercial", "industrial", "mixed"],
    });
  }

  if (!extraction.total_area_m2 || extraction.total_area_m2 <= 0) {
    gaps.push({
      field: "total_area_m2",
      label: "Área total a climatizar (m²)",
      priority: "critical",
      inputType: "number",
    });
  }

  if (!extraction.floors || extraction.floors < 1) {
    gaps.push({
      field: "floors",
      label: "Cantidad de pisos",
      priority: "critical",
      inputType: "number",
    });
  }

  if (!extraction.ceiling_height_m) {
    gaps.push({
      field: "ceiling_height_m",
      label: "Altura de techo (m)",
      priority: "helpful",
      inputType: "number",
    });
  }

  if (!extraction.occupants_estimate) {
    gaps.push({
      field: "occupants_estimate",
      label: "Cantidad estimada de ocupantes",
      priority: "helpful",
      inputType: "number",
    });
  }

  if (!extraction.insulation_quality || extraction.insulation_quality === "unknown") {
    gaps.push({
      field: "insulation_quality",
      label: "Calidad del aislamiento",
      priority: "helpful",
      inputType: "choice",
      options: ["poor", "standard", "good"],
    });
  }

  if (!extraction.preferred_system_type || extraction.preferred_system_type === "unspecified") {
    gaps.push({
      field: "preferred_system_type",
      label: "Tipo de sistema preferido (si tenés preferencia)",
      priority: "helpful",
      inputType: "choice",
      options: ["mini_split", "split_central", "vrf", "chiller", "rooftop", "unspecified"],
    });
  }

  return gaps;
}

export function hasCriticalGaps(extraction: Partial<ProjectExtraction>): boolean {
  return identifyGaps(extraction).some((g) => g.priority === "critical");
}
