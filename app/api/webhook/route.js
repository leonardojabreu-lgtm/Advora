// app/api/webhook/route.js

const VERIFY_TOKEN = "advora_verify"; // por enquanto só pra log

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge") ?? "no-challenge";

  console.log("VERIFICACAO WEBHOOK:", { mode, token, challenge });

  // NÃO vamos recusar nada aqui, só devolver o challenge
  return new Response(challenge, { status: 200 });
}

export async function POST(request) {
  const body = await request.json().catch(() => null);

  if (!body || !body.entry) {
    return new Response("No body", { status: 200 });
  }

  console.log("Webhook recebido:", JSON.stringify(body, null, 2));

  // aqui depois a gente chama a Carolina / OpenAI

  return new Response("EVENT_RECEIVED", { status: 200 });
}
