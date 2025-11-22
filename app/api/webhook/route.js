import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// assistant_id DA CAROLINA
const CAROLINA_ID = "asst_XvvYmp7mTVlTPjUqQs99ESsO"; // coloque o SEU

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.entry || !body.entry[0].changes) {
      return new Response("No body", { status: 200 });
    }

    // pega a mensagem recebida
    const message = body.entry[0].changes[0].value.messages?.[0];

    if (!message) return new Response("ok", { status: 200 });

    const texto = message.text?.body || "";
    const from = message.from;

    console.log("Mensagem recebida:", texto);

    // cria uma thread da Carolina
    const thread = await openai.beta.threads.create();

    // envia a mensagem para a Carolina
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: texto
    });

    // executa a Carolina
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: CAROLINA_ID
    });

    // aguarda o processamento
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    while (runStatus.status !== "completed") {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // pega a resposta final
    const mensagens = await openai.beta.threads.messages.list(thread.id);

    const resposta = mensagens.data[0].content[0].text.value;

    console.log("Resposta da Carolina:", resposta);

    // agora envia pro WhatsApp
    await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: resposta }
        })
      }
    );

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("Erro", { status: 500 });
  }
}
