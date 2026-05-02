import { z } from "zod";

// What the AI extracts from uploaded documents.
// All fields optional — the AI fills what it can see, we identify gaps after.
export const projectExtractionSchema = z.object({
  building_type: z.enum(["residential", "commercial", "industrial", "mixed"]).nullable().optional(),
  client_name: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  total_area_m2: z.number().nullable().optional(),
  floors: z.number().int().nullable().optional(),
  ceiling_height_m: z.number().nullable().optional(),
  zones: z
    .array(
      z.object({
        name: z.string(),
        area_m2: z.number().nullable().optional(),
        occupancy: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  insulation_quality: z.enum(["poor", "standard", "good", "unknown"]).nullable().optional(),
  windows_orientation: z.string().nullable().optional(),
  occupants_estimate: z.number().int().nullable().optional(),
  preferred_system_type: z
    .enum(["mini_split", "split_central", "vrf", "chiller", "rooftop", "unspecified"])
    .nullable()
    .optional(),
  special_requirements: z.array(z.string()).nullable().optional(),
  source_summary: z.string().describe("Brief summary of what was visible/inferred from the uploaded documents."),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ProjectExtraction = z.infer<typeof projectExtractionSchema>;

// What the AI returns when asked what's missing
export const clarificationSchema = z.object({
  questions: z.array(
    z.object({
      field: z.string().describe("Field path like 'total_area_m2' or 'zones[0].area_m2'"),
      question: z.string().describe("Question to ask the user, in Spanish"),
      priority: z.enum(["critical", "helpful"]),
      input_type: z.enum(["number", "text", "choice"]),
      options: z.array(z.string()).nullable().optional(),
    }),
  ),
});

export type Clarification = z.infer<typeof clarificationSchema>;

// What the AI returns when recommending equipment
export const equipmentRecommendationSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string().describe("SKU exact match from catalog. Empty string if no match (use custom_name)."),
      custom_name: z.string().nullable().optional().describe("Use only if no catalog SKU matches."),
      quantity: z.number().positive(),
      reasoning: z.string().describe("Brief one-line justification in Spanish"),
    }),
  ),
  notes: z.string().nullable().optional().describe("General notes for the engineer reviewing the quote"),
});

export type EquipmentRecommendation = z.infer<typeof equipmentRecommendationSchema>;
