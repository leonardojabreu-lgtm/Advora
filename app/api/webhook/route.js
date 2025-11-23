// app/api/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, CAROLINA_MODEL } from "@/lib/openai";

export const dynamic = "force-dynamic"; // se estiver usando Next 13/14 app router

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // aqui você extrai a mensagem do WhatsApp
    const userMessage =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ??
      "Oi";

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
- Evitar falar em primeira pessoa como “obrigada por confiar em mim”; sempre responda em nome do escritório.
`;

    // chamada para o modelo fine-tuned
    const response = await openai.responses.create({
      model: CAROLINA_MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const answer =
      response.output?.[0]?.content?.[0]?.text ?? "Olá! Como posso te ajudar?";

    // aqui você monta a resposta de volta pro WhatsApp (Meta)
    // vou deixar genérico porque cada um monta de um jeito
    return NextResponse.json({
      reply: answer,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Erro interno no webhook" },
      { status: 500 }
    );
  }
}
