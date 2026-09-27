import { z } from "zod";

export const roomCodeSchema = z.string().trim().toUpperCase().regex(
  /^[A-HJ-KM-NP-Z2-9]{6}$/,
  "Enter the six-character code from your invitation.",
);

export const displayNameSchema = z.string().trim().min(1).max(24);
