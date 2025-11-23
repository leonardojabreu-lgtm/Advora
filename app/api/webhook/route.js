import { NextResponse } from "next/server";
// caminho relativo da pasta app/api/webhook até a pasta lib
import { openai, CAROLINA_MODEL } from "src/lib/openai.ts";

export const dynamic = "force-dynamic";

// GET – verificação do webhook da Meta
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

// POST – recebe mensagem do WhatsApp e responde com a Carolina
export async function POST(req) {
  try {
    const body = await req.json();

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    // Se não for mensagem de texto, ignora
    if (!message || !message.text || !message.text.body) {
      return NextResponse.json({ status: "ignored" });
    }

    const sender = message.from;
    const userMessage = message.text.body;

    const systemPrompt = `
Você é a CAROLINA, secretária virtual de um escritório de advocacia especializado em:

- Problemas com serviços essenciais (água, luz, internet/telefone)
- Problemas com bancos (negativação indevida, débitos não reconhecidos, redução de limite etc.)

O escritório atua principalmente em Niterói/RJ e região e possui um ADVOGADO RESPONSÁVEL TÉCNICO regularmente inscrito na OAB/RJ sob o nº 188.795.

SEU PAPEL:
- Fazer o PRIMEIRO ATENDIMENTO dos contatos que chegam pelo WhatsApp.
- Gerar CONFIANÇA rápida, mostrando que é um escritório real e organizado.
- Coletar TODAS as informações essenciais do caso.
- Explicar, de forma simples, como funciona o atendimento do escritório.
- Preparar um RESUMO organizado do caso para o advogado responsável e sua equipe.
- Nunca dar opinião jurídica, nunca prometer resultado e nunca falar como se fosse o advogado.
- Evitar frases como “obrigada por confiar em mim”; fale sempre em nome do escritório.
`;

    // Chamada para o modelo fine-tuned (Responses API)
    const response = await openai.responses.create({
      model: CAROLINA_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const aiText =
      response?.output?.[0]?.content?.[0]?.text ||
      "Olá! Como posso ajudar você hoje?";

    // Envia a resposta para o WhatsApp
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
  } catch (error) {
    console.error("Erro no webhook:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
