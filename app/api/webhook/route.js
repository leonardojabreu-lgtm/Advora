import { NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

// Configuração do cliente OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "ft:gpt-4o-mini-2024-07-18:personal:carolinaai:Cf3xgQkT";

// ----------------------------------------------------------------------
// GET - Verificação do Token da Meta
// ----------------------------------------------------------------------
export async function GET(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Erro de verificação", { status: 403 });
}

// ----------------------------------------------------------------------
// POST - Webhook de Mensagens do WhatsApp
// ----------------------------------------------------------------------
export async function POST(req) {
  try {
    const body = await req.json();

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || !message.text || !message.text.body) {
      return NextResponse.json({ status: "ignored" });
    }

    const sender = message.from;
    const userMessage = message.text.body;

    const systemPrompt = `
Você é a CAROLINA, secretária virtual do escritório...
(continua igual)
`;

    const response = await client.responses.create({
      model: MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
    });

    const aiText =
      response.output?.[0]?.content?.[0]?.text ||
      "Olá! Como posso ajudar você hoje?";

    await fetch(
      `https://graph.facebook.com/v22.0/${process.env.META_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: sender,
          text: { body: aiText },
        }),
      }
    );

    return NextResponse.json({ status: "message_sent", reply: aiText });

  } catch (err) {
    console.error("Erro no webhook:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
