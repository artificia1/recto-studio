import { z } from 'zod/v4';

const path = z.string().min(1).max(1024);
export const publicationRecipe = z.strictObject({
  manuscript: path,
  output: path.describe('New workspace-relative folder for the compiled edition'),
  title: z.string().trim().min(1).max(200).optional(),
  author: z.string().trim().max(200).optional(),
  preset: z.enum(['trade-paperback-6x9', 'digest-5.5x8.5']).default('trade-paperback-6x9'),
  language: z.string().min(2).max(64).default('en'),
  pdfPreset: z.enum(['print', 'press', 'pdfx1a', 'pdfx4']).default('press'),
  printResources: path.describe('Optional Recto project supplying already embedded fonts and CMYK ICC settings').optional(),
  fontFamily: z.string().trim().min(1).max(150).optional(),
  paperSpec: z.strictObject({
    caliperMm: z.number().positive().max(2).describe('Measured thickness in millimeters per leaf'),
    gsm: z.number().min(20).max(500).optional(),
    finish: z.string().trim().max(60).optional(),
  }).optional(),
  pagesPerSignature: z.union([z.literal(4), z.literal(8), z.literal(16), z.literal(32)]).optional(),
  targetSignatures: z.int().min(1).max(125).optional(),
  sheetProof: z.boolean().default(false),
  proofPage: z.int().min(1).max(500).default(1),
  previousPdf: path.describe('Optional prior reader-order interior PDF for a same-page visual comparison').optional(),
});

export type PublicationRecipe = z.infer<typeof publicationRecipe>;

export const publicationPlan = publicationRecipe.omit({ output: true, proofPage: true, previousPdf: true, sheetProof: true });
export type PublicationPlan = z.infer<typeof publicationPlan>;
