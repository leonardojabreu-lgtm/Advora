import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req) {
  return new Response("OK - GET funcionando", { status: 200 });
}

export async function POST(req) {
  return NextResponse.json({ status: "ok", message: "Webhook básico rodando" });
}
