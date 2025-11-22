// app/api/webhook/route.js

export const runtime = "nodejs";

import OpenAI from "openai";

// token usado na verificação do webhook (GET)
const VERIFY_TOKEN = "advora_verify";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT_CAROLINA ||
  "Você é Carolina, secretária humana do escritório ADVORA. Seja empática, humana e natural.";

// ============ VERIFICAÇÃO DO WEBHOOK (GET) ============

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge") ?? "no-challenge";

  console.log("VERIFICACAO WEBHOOK:", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ============ RECEBIMENTO DE MENSAGENS (POST) ============

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || !body.entry || !body.entry[0]?.changes) {
      console.log("Webhook sem conteúdo relevante:", JSON.stringify(body));
      return new Response("No body", { status: 200 });
    }

    const change = body.entry[0].changes[0];
    const value = change.value || {};
    const message = value.messages?.[0];

    if (!message) {
      console.log("Evento sem mensagem (provavelmente status):", JSON.stringify(value));
      return new Response("OK", { status: 200 });
    }

    if (message.type !== "text") {
      console.log("Mensagem não-texto recebida, ignorando:", message.type);
      return new Response("OK", { status: 200 });
    }

    const from = message.from;
    const texto = message.text?.body || "";

    console.log("Mensagem recebida do WhatsApp:", { from, texto });

    // ========== CHAMADA À API DA OPENAI (CAROLINA) ==========

    const aiResponse = await client.responses.create({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,   // << AQUI ESTÁ A CORREÇÃO
      input: texto,
    });

    const respostaCarolina = aiResponse.output_text || "";

    console.log("Resposta da Carolina:", respostaCarolina);

    // ========== ENVIO DA RESPOSTA PARA O WHATSAPP ==========

    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
      console.error("Faltam WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID nas env vars");
      return new Response("Config error", { status: 500 });
    }

    const waRes = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: respostaCarolina.substring(0, 1000) },
        }),
      }
    );

    const waText = await waRes.text();

    if (!waRes.ok) {
      console.error("Erro ao enviar mensagem para WhatsApp:", waText);
    } else {
      console.log("Mensagem enviada ao WhatsApp com sucesso:", waText);
    }

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("Erro no webhook:", error);
    return new Response("Erro", { status: 500 });
  }
}
