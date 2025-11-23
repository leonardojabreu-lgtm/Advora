import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY não configurada nas variáveis da Vercel");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const CAROLINA_MODEL =
  process.env.OPENAI_MODEL_CAROLINA ??
  "ft:gpt-4o-mini-2024-07-18:personal:carolinaai:Cf3xgQkT";
