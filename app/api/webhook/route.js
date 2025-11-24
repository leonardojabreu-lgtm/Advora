export const runtime = "nodejs";

import OpenAI from "openai";
import { supabase } from "../../../lib/supabase";

// token usado na verificação do webhook (GET)
const VERIFY_TOKEN = "advora_verify";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// SYSTEM PROMPT da Carolina
const BASE_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT_CAROLINA ||
  `
Você é a Carolina, secretária HUMANA de um escritório de advocacia focado em:

- Problemas com serviços essenciais (água, luz, internet/telefone)
- Problemas com bancos (negativação indevida, débito não reconhecido, cobrança indevida etc.)

REGRAS GERAIS:
- Fale sempre de forma humana, empática e natural, como uma pessoa real de escritório.
- Não se apresente como inteligência artificial. Você é apenas "Carolina, secretária do escritório".
- Não mencione nome fantasia interno ou marca do software.
- Não peça CPF nem telefone alternativo (a conversa já é pelo WhatsApp).
- Não dê opinião jurídica técnica, não prometa resultado, não fale em valores de indenização.
- Seu papel é: ouvir, acolher, organizar a história e coletar os dados/documentos necessários para o ADVOGADO analisar.

SOBRE DOCUMENTOS:
- Para casos de água, luz, internet/telefone ou bancos, você SEMPRE deve pedir pelo menos:
  - foto da conta/fatura relacionada ao problema; OU
  - documento que comprove o problema (tela de aplicativo, boleto, notificação etc.).
- Explique que o advogado só consegue analisar de verdade depois que tiver pelo menos um documento.
- Seja firme porém acolhedora: sem documento, você NÃO avança para explicar o que o advogado vai fazer, não entra em detalhes de processo, não fala em valores.
`;

// ===== FUNÇÕES DE MEMÓRIA (SUPABASE) =====

const defaultDocs = { hasMedia: false };

async function getConversation(phone) {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("history, state, docs")
      .eq("phone", phone)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Erro ao buscar conversa:", error);
    }

    if (!data) {
      return {
        history: [],
        state: "initial",
        docs: { ...defaultDocs },
      };
    }

    return {
      history: data.history || [],
      state: data.state || "initial",
      docs: { ...defaultDocs, ...(data.docs || {}) },
    };
  } catch (err) {
    console.error("Erro inesperado ao buscar conversa:", err);
    return {
      history: [],
      state: "initial",
      docs: { ...defaultDocs },
    };
  }
}

async function saveConversation(phone, { history, state, docs }) {
  try {
    const payload = {
      phone,
      history: history || [],
      state: state || "initial",
      docs: docs || { ...defaultDocs },
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("conversations")
      .upsert(payload);

    if (error) {
      console.error("Erro ao salvar conversa:", error);
    }
  } catch (err) {
    console.error("Erro inesperado ao salvar conversa:", err);
  }
}

async function marcarDocumentoRecebido(phone) {
  const conv = await getConversation(phone);
  const docs = { ...conv.docs, hasMedia: true };

  // Opcional: registrar no histórico que um documento foi enviado
  const novoHistorico = [
    ...conv.history,
    {
      role: "system",
      content: "[DOCUMENTO] O usuário enviou uma imagem/arquivo (fatura ou documento).",
    },
  ];

  await saveConversation(phone, {
    history: novoHistorico,
    state: conv.state,
    docs,
  });

  return { history: novoHistorico, state: conv.state, docs };
}

// ===== VERIFICAÇÃO DO WEBHOOK (GET) =====

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge") ?? "no-challenge";

  console.log("VERIFICACAO WEBHOOK:", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Erro na verificação do webhook", { status: 403 });
}

// ===== RECEBIMENTO DE MENSAGENS (POST) =====

export async function POST(request) {
  try {
    const body = await request.json();
    // console.log("WEBHOOK BODY:", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return new Response("ok", { status: 200 });
    }

    const userPhone = message.from;
    const messageType = message.type;

    console.log("MENSAGEM RECEBIDA:", {
      userPhone,
      messageType,
    });

    const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const waToken = process.env.WHATSAPP_TOKEN;

    // ========== SE FOR MÍDIA (IMAGEM/DOCUMENTO), APENAS REGISTRA DOC E AGRADECE ==========
    if (messageType === "image" || messageType === "document") {
      const caption =
        message.image?.caption ||
        message.document?.caption ||
        "";

      const conv = await marcarDocumentoRecebido(userPhone);

      // Mensagem curtinha de confirmação
      const ackText =
        "Perfeito, acabei de receber o documento aqui. Se tiver mais alguma conta ou comprovante, pode me enviar também. Se preferir, pode me explicar em poucas palavras o que mais está te preocupando.";

      if (waPhoneId && waToken) {
        const graphRes = await fetch(
          `https://graph.facebook.com/v22.0/${waPhoneId}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${waToken}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: userPhone,
              type: "text",
              text: { body: ackText },
            }),
          }
        );

        if (!graphRes.ok) {
          const errorText = await graphRes.text();
          console.error(
            "Erro ao enviar ACK de documento para WhatsApp:",
            graphRes.status,
            errorText
          );
        }
      } else {
        console.error(
          "WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_TOKEN não configurados (mensagem de mídia)"
        );
      }

      return new Response("ok", { status: 200 });
    }

    // ========== SE NÃO FOR TEXTO, IGNORA ==========
    if (messageType !== "text") {
      return new Response("ok", { status: 200 });
    }

    // A partir daqui: mensagem de TEXTO normal
    const userText = message.text?.body?.trim() || "";

    if (!userText) {
      return new Response("ok", { status: 200 });
    }

    // 1) Buscar conversa completa (histórico + estado + docs)
    const conv = await getConversation(userPhone);
    const { history, docs } = conv;

    // 2) Montar SYSTEM PROMPT DINÂMICO CONFORME DOCUMENTOS
    let systemPrompt = BASE_SYSTEM_PROMPT;

    if (!docs.hasMedia) {
      // Nenhum documento ainda: Carolina fica "travada" pedindo docs
      systemPrompt += `
ATENÇÃO, CAROLINA (INSTRUÇÃO INTERNA, NÃO FALE ISSO EM VOZ ALTA):
- Ainda NÃO recebemos nenhum documento (foto de conta, boleto, comprovante).
- Você DEVE continuar pedindo, com calma, que a pessoa envie pelo menos um documento (conta, fatura, comprovante, print do aplicativo).
- Você PODE acolher, fazer perguntas para entender melhor a situação, mas NÃO deve avançar para explicar estratégia jurídica, não falar de valores, não dizer que "vai entrar com ação" de forma categórica.
- Só quando os documentos forem enviados (o sistema vai te avisar no histórico com a tag [DOCUMENTO]) é que você pode começar a falar em "encaminhar para o advogado analisar" e próximos passos.
`;
    } else {
      // Já temos documento: Carolina pode ir para explicação leve de próximos passos
      systemPrompt += `
ATENÇÃO, CAROLINA (INSTRUÇÃO INTERNA, NÃO FALE ISSO EM VOZ ALTA):
- Já recebemos pelo menos um documento do cliente.
- Agora você pode:
  - organizar o resumo do caso,
  - reforçar que o advogado vai analisar os documentos,
  - explicar, de forma simples, que o escritório normalmente entra com ação quando há falha de serviço, mas SEM prometer resultado nem falar em valores específicos.
`;
    }

    // 3) Montar input para a OpenAI
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userText },
    ];

    const completion = await client.responses.create({
      model: process.env.OPENAI_MODEL_CAROLINA || "gpt-4.1-mini",
      input: messages,
    });

    const openAIOutput = completion.output?.[0]?.content?.[0];

    const assistantReply =
      (openAIOutput?.type === "output_text" && openAIOutput.text) ||
      "Tive um probleminha aqui, mas já estou ajustando. Você pode me contar de novo, em poucas palavras, o que está acontecendo?";

    console.log("RESPOSTA CAROLINA:", assistantReply);

    // 4) Atualizar histórico na conversa
    const newHistory = [
      ...history,
      { role: "user", content: userText },
      { role: "assistant", content: assistantReply },
    ];

    await saveConversation(userPhone, {
      history: newHistory,
      state: conv.state,
      docs,
    });

    // 5) Enviar resposta pelo WhatsApp (Meta)
    if (!waPhoneId || !waToken) {
      console.error(
        "WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_TOKEN não configurados (mensagem de texto)"
      );
    } else {
      const graphRes = await fetch(
        `https://graph.facebook.com/v22.0/${waPhoneId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${waToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: userPhone,
            type: "text",
            text: { body: assistantReply },
          }),
        }
      );

      if (!graphRes.ok) {
        const errorText = await graphRes.text();
        console.error(
          "Erro ao enviar mensagem para WhatsApp:",
          graphRes.status,
          errorText
        );
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("ERRO NO WEBHOOK POST:", err);
    return new Response("Erro interno no webhook", { status: 500 });
  }
}
