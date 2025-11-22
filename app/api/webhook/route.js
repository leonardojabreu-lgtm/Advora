// app/api/webhook/route.js

import OpenAI from "openai";

// token usado só na VERIFICAÇÃO do webhook (GET)
const VERIFY_TOKEN = "advora_verify";

// cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// IDs e tokens vindos das variáveis de ambiente
const CAROLINA_ID = process.env.CAROLINA_ID;           // asst_...
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;     // token permanente Meta
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID; // phone_number_id

// >>> VERIFICAÇÃO DO WEBHOOK (META) <<<
// NÃO MEXE MAIS NISSO, JÁ ESTÁ FUNCIONANDO
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

// >>> RECEBIMENTO DE MENSAGENS <<<

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || !body.entry || !body.entry[0].changes) {
      console.log("Webhook sem conteúdo relevante:", JSON.stringify(body));
      return new Response("No body", { status: 200 });
    }

    const change = body.entry[0].changes[0];
    const value = change.value || {};
    const message = value.messages?.[0];

    // eventos de status (entregue, lido etc.) chegam sem "messages"
    if (!message) {
      console.log("Evento sem mensagem (provavelmente status):", JSON.stringify(value));
      return new Response("OK", { status: 200 });
    }

    // só responde a mensagens de texto
    if (message.type !== "text") {
      console.log("Mensagem não-texto, ignorando:", message.type);
      return new Response("OK", { status: 200 });
    }

    const from = message.from;             // número do cliente
    const texto = message.text?.body || ""; // texto da mensagem

    console.log("Mensagem recebida do WhatsApp:", { from, texto });

    if (!CAROLINA_ID || !process.env.OPENAI_API_KEY) {
      console.error("Falta CAROLINA_ID ou OPENAI_API_KEY nas variáveis de ambiente");
      return new Response("Config error", { status: 500 });
    }

    // 1) Cria uma thread para a Carolina
    const thread = await openai.beta.threads.create();

    // 2) Adiciona a mensagem do usuário
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: texto
    });

    // 3) Executa a Carolina
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: CAROLINA_ID
    });

    // 4) Espera a Carolina terminar (polling simples)
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    let tentativas = 0;
    while (runStatus.status !== "completed" && tentativas < 15) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      tentativas++;
    }

    if (runStatus.status !== "completed") {
      console.error("Carolina não completou a tempo:", runStatus.status);
      return new Response("Timeout Carolina", { status: 500 });
    }

    // 5) Busca a última mensagem da Carolina
    const mensagens = await openai.beta.threads.messages.list(thread.id);

    const respostaCarolina = mensagens.data
      .filter((m) => m.role === "assistant")[0]
      ?.content?.[0]?.text?.value;

    if (!respostaCarolina) {
      console.error("Não foi possível extrair resposta da Carolina");
      return new Response("Sem resposta", { status: 500 });
    }

    console.log("Resposta da Carolina:", respostaCarolina);

    // 6) Envia a resposta de volta pelo WhatsApp
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
      console.error("Faltam WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID nas env vars");
      return new Response("Config error", { status: 500 });
    }

    const waResponse = await fetch(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_TOKEN}`
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: respostaCarolina }
        })
      }
    );

    if (!waResponse.ok) {
      const erroTexto = await waResponse.text();
      console.error("Erro ao enviar mensagem para WhatsApp:", erroTexto);
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Erro no webhook:", e);
    return new Response("Erro", { status: 500 });
  }
}
