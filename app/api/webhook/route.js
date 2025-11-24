// app/api/webhook/route.js
export const runtime = "nodejs";

import OpenAI from "openai";

// ===============================
// CONFIGURAÇÕES
// ===============================
const VERIFY_TOKEN = "advora_verify";

// seu modelo fine-tuned
const MODEL_CAROLINA = "ft:gpt-4o-mini-2024-07-18:personal:carolina-v1:CfX9wHOI";

// client OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// prompt opcional
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT_CAROLINA ||
  "Você é Carolina, secretária humana, empática e natural.";

// ===============================
// ESTADO TEMPORÁRIO POR USUÁRIO
// ===============================
const memory = {}; // ideal: depois migrar para supabase

function initUserState(phone) {
  if (!memory[phone]) {
    memory[phone] = {
      awaiting_docs: false,
      rg: false,
      cpf: false,
      comprovante: false,
      procuracao: false,
    };
  }
  return memory[phone];
}

function getMissingDocs(state) {
  const missing = [];
  if (!state.rg) missing.push("rg");
  if (!state.cpf) missing.push("cpf");
  if (!state.comprovante) missing.push("comprovante");
  if (!state.procuracao) missing.push("procuracao");
  return missing;
}

// ===============================
// CLASSIFICAÇÃO DE DOCUMENTOS (VISÃO)
// ===============================
async function classifyDocumentImage(imageUrl) {
  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini", // visão
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Identifique qual documento está na imagem. Responda somente com um JSON no formato {\"tipo\":\"valor\"}. Valores possíveis: \"rg\", \"cpf\", \"comprovante\", \"procuracao\", \"outro\"."
            },
            {
              type: "input_image",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_output_tokens: 50,
    });

    const txt = response.output[0]?.content[0]?.text || "";
    const parsed = JSON.parse(txt.trim());
    return parsed.tipo || "outro";

  } catch (err) {
    console.error("Erro ao classificar documento:", err);
    return "outro";
  }
}

// ===============================
// ENVIO PARA WHATSAPP
// ===============================
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text.substring(0, 1000) },
    }),
  });

  if (!res.ok) {
    console.error(await res.text());
  }
}

// ===============================
// ===== VERIFICAÇÃO (GET) =======
// ===============================
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge") ?? "no-challenge";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ===============================
// ===== RECEBIMENTO (POST) ======
// ===============================
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body?.entry?.[0]?.changes) {
      return new Response("No body", { status: 200 });
    }

    const change = body.entry[0].changes[0];
    const message = change.value?.messages?.[0];
    if (!message) return new Response("OK", { status: 200 });

    const from = message.from;
    let state = initUserState(from);

    // ===========================
    // IMAGEM — CLASSIFICAR DOC
    // ===========================
    if (message.type === "image") {
      const imageUrl = message.image.url;
      const tipo = await classifyDocumentImage(imageUrl);

      console.log("Documento identificado:", tipo);

      if (tipo === "outro") {
        await sendWhatsAppText(
          from,
          "Acho que a imagem veio um pouco desfocada. Você consegue enviar outra foto um pouco mais nítida, por favor?"
        );
        return new Response("OK", { status: 200 });
      }

      // marcar documento
      state[tipo] = true;

      // verificar checklist
      const missing = getMissingDocs(state);

      if (missing.length === 0) {
        state.awaiting_docs = false;

        await sendWhatsAppText(
          from,
          "Perfeito! Recebi todos os documentos necessários. Vou organizar tudo e a Marina Castro, nossa assistente executiva, vai te acompanhar nas próximas etapas."
        );

      } else {
        const next = missing[0];
        const label = {
          rg: "a foto do seu RG",
          cpf: "a foto do seu CPF",
          comprovante: "a foto do seu comprovante de residência atualizado",
          procuracao: "a foto da procuração assinada",
        };

        await sendWhatsAppText(
          from,
          `Documento recebido. Agora só falta ${label[next]}. Pode enviar por aqui mesmo.`
        );
      }

      return new Response("OK", { status: 200 });
    }

    // ===========================
    // TEXTO
    // ===========================
    if (message.type === "text") {
      const texto = message.text.body || "";

      // Se estiver aguardando documentos, NÃO deixa avançar
      if (state.awaiting_docs) {
        const missing = getMissingDocs(state);
        if (missing.length > 0) {
          const next = missing[0];
          const label = {
            rg: "a foto do seu RG",
            cpf: "a foto do seu CPF",
            comprovante: "a foto do seu comprovante de residência atualizado",
            procuracao: "a foto da procuração assinada",
          };

          await sendWhatsAppText(
            from,
            `Tudo certo. Só falta ${label[next]} para concluirmos esta etapa.`
          );
          return new Response("OK", { status: 200 });
        }
      }

      // gerar resposta da Carolina
      const ai = await client.responses.create({
        model: MODEL_CAROLINA,
        instructions: SYSTEM_PROMPT,
        input: texto,
        max_output_tokens: 300,
      });

      const respostaCarolina =
        ai.output_text?.substring(0, 1000) || "Estou aqui para ajudar.";

      await sendWhatsAppText(from, respostaCarolina);

      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Erro geral:", err);
    return new Response("Erro", { status: 500 });
  }
}
