export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  const body = await request.json();

  // Segurança: validar origem
  if (!body.object) {
    return new Response("No content", { status: 200 });
  }

  // Extração de mensagem
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message) {
    const from = message.from;
    const text = message.text?.body ?? "";

    console.log("Nova mensagem:", from, text);

    // Aqui chamaremos a Carolina (OpenAI)
  }

  return new Response("OK", { status: 200 });
}
