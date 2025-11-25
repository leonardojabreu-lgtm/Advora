export const runtime = "nodejs"; // obrigatório na Vercel para usar fs, path e supabase

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";

// 🔐 Variáveis de ambiente usadas no sistema
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// token usado na verificação do webhook (GET)
const VERIFY_TOKEN = "advora_verify";

// 🌐 Cliente Supabase (backend)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 🤖 Cliente OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// 📄 Caminho do System Prompt da Carolina V2
const systemPromptPath = path.join(
  process.cwd(),
  "app",
  "prompts",
  "system_prompt_carolina_v2.txt"
);

// 📄 Caminho do fluxo de atendimento da Carolina
const atendimentoPromptPath = path.join(
  process.cwd(),
  "app",
  "prompts",
  "atendimento.txt"
);

// 🧠 Leitura (uma vez só) dos prompts
const SYSTEM_PROMPT = await fs.readFile(systemPromptPath, "utf8");
const ATENDIMENTO_PROMPT = await fs.readFile(atendimentoPromptPath, "utf8");

// ===== VERIFICAÇÃO DO WEBHOOK (GET) =====
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

// 🔽 Baixa a mídia do WhatsApp (Meta) usando o media_id
async function downloadMediaFromMeta(mediaId) {
  const metaInfoRes = await fetch(
    `https://graph.facebook.com/v22.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
    }
  );

  if (!metaInfoRes.ok) {
    console.error(
      "Erro ao buscar info da mídia na Meta:",
      await metaInfoRes.text()
    );
    throw new Error("Erro ao buscar info da mídia na Meta");
  }

  const metaInfo = await metaInfoRes.json();
  const mediaUrl = metaInfo.url;

  const fileRes = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
  });

  if (!fileRes.ok) {
    console.error("Erro ao fazer download da mídia:", await fileRes.text());
    throw new Error("Erro ao fazer download da mídia");
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const mimeType = fileRes.headers.get("content-type") || "image/jpeg";

  return { buffer, mimeType };
}

// ☁️ Sobe a mídia para um bucket "carolina" no Supabase
async function uploadToSupabase(phone, buffer, mimeType) {
  const ext = mimeType.includes("pdf") ? "pdf" : "jpg";
  const fileName = `${phone}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from("carolina")
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error("Erro ao salvar arquivo no Supabase:", error.message);
    throw new Error("Erro ao salvar arquivo no Supabase");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("carolina").getPublicUrl(fileName);

  return publicUrl;
}

// 👀 Classifica o tipo de documento via OpenAI (visão)
async function classifyDocument(publicUrl) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `
Você é um classificador de documentos brasileiros.
Analise a imagem e responda APENAS em JSON, SEM nenhum texto extra, exatamente neste formato:

{
  "tipo": "rg|cnh|comprovante_residencia|protocolo|foto_dano|outro",
  "descricao_curta": "breve descrição do que aparece na imagem"
}

Se não tiver certeza, use "outro".
        `.trim(),
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Analise esse arquivo e classifique o tipo de documento.",
          },
          {
            type: "input_image",
            image_url: publicUrl,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.output[0].content[0].text;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Erro ao parsear JSON da classificação:", raw);
    parsed = { tipo: "outro" };
  }

  return parsed.tipo;
}

// 🧾 Salva no histórico + consolida o checklist por telefone
async function updateDocsState(phone, docType, fileUrl) {
  const { error: insertError } = await supabase
    .from("carolina_documents")
    .insert({
      phone,
      doc_type: docType,
      file_url: fileUrl,
    });

  if (insertError) {
    console.error(
      "Erro ao inserir em carolina_documents:",
      insertError.message
    );
  }

  const patch = {};

  if (docType === "rg" || docType === "cnh") {
    patch.has_rg = true;
  }

  if (docType === "comprovante_residencia") {
    patch.has_comprovante = true;
  }

  if (docType === "protocolo") {
    patch.has_protocolos = true;
  }

  if (docType === "foto_dano") {
    patch.has_fotos_danos = true;
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("carolina_docs_state")
    .upsert({ phone, ...patch }, { onConflict: "phone" })
    .select()
    .single();

  if (error) {
    console.error(
      "Erro ao atualizar carolina_docs_state:",
      error.message
    );
    throw new Error("Erro ao atualizar estado de documentos");
  }

  return data;
}

// ✅ Define quais documentos já chegaram e quais ainda faltam
function buildDocsStatusMessage(docsState) {
  const recebidos = [];
  const faltando = [];

  if (docsState.has_rg) {
    recebidos.push("RG ou CNH");
  } else {
    faltando.push("RG ou CNH");
  }

  if (docsState.has_comprovante) {
    recebidos.push("comprovante de residência");
  } else {
    faltando.push("comprovante de residência");
  }

  if (docsState.has_protocolos) {
    recebidos.push("protocolos");
  } else {
    faltando.push("protocolos");
  }

  if (docsState.has_fotos_danos) {
    recebidos.push("fotos de prejuízos/danos");
  }

  return { recebidos, faltando };
}

// 📲 Envia mensagem de texto no WhatsApp pelo Graph API
async function sendWhatsappMessage(phone, text) {
  const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Erro ao enviar mensagem no WhatsApp:", await res.text());
  }
}

// ===== HANDLER PRINCIPAL (POST) =====
export async function POST(request) {
  const body = await request.json();
  // console.log("WEBHOOK BODY", JSON.stringify(body, null, 2));

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  if (!message) {
    return new Response("NO_MESSAGE", { status: 200 });
  }

  const phone = message.from;

  try {
    // 🔵 FLUXO DE DOCUMENTOS (imagem ou PDF)
    if (message.type === "image" || message.type === "document") {
      const mediaId =
        message.type === "image" ? message.image.id : message.document.id;

      const { buffer, mimeType } = await downloadMediaFromMeta(mediaId);

      const publicUrl = await uploadToSupabase(phone, buffer, mimeType);

      const docType = await classifyDocument(publicUrl);

      const docsState = await updateDocsState(phone, docType, publicUrl);
      const { recebidos, faltando } = buildDocsStatusMessage(docsState);

      const docsContext = `
Status documental deste cliente (telefone ${phone}):

- Documentos recebidos: ${
        recebidos.length ? recebidos.join(", ") : "nenhum ainda"
      }.
- Documentos ainda faltando: ${
        faltando.length ? faltando.join(", ") : "nenhum, checklist completo"
      }.

A Carolina deve reagir de forma humana, agradecendo pelos documentos
e, se ainda faltar algo, dizer algo na linha:

"Perfeito, recebi [lista dos recebidos]. Agora ficou faltando apenas [documento(s) faltando].
Assim que você me enviar, eu te envio a procuração para finalizarmos o seu processo."

Se não estiver faltando nada, a Carolina deve dizer que recebeu tudo e que vai enviar a procuração.
      `.trim();

      const history = []; // futura integração com histórico, se quiser

      const completion = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: ATENDIMENTO_PROMPT },
          { role: "system", content: docsContext },
          ...history,
          {
            role: "user",
            content:
              "Acabei de te enviar um documento agora pelo WhatsApp.",
          },
        ],
      });

      const replyText = completion.output[0].content[0].text;

      await sendWhatsappMessage(phone, replyText);

      return new Response("OK_MEDIA", { status: 200 });
    }

    // 🔵 FLUXO DE TEXTO NORMAL DA CAROLINA
    if (message.type === "text") {
      const userText = message.text.body;

      const history = []; // futura integração com histórico

      const completion = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: ATENDIMENTO_PROMPT },
          ...history,
          { role: "user", content: userText },
        ],
      });

      const replyText = completion.output[0].content[0].text;

      await sendWhatsappMessage(phone, replyText);

      return new Response("OK_TEXT", { status: 200 });
    }

    await sendWhatsappMessage(
      phone,
      "Neste momento, consigo te atender melhor por texto ou enviando fotos/documentos dos casos, tudo bem?"
    );

    return new Response("OK_OTHER", { status: 200 });
  } catch (err) {
    console.error("Erro no webhook:", err);
    return new Response("ERROR", { status: 200 });
  }
}
