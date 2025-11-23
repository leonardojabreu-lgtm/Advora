console.log("META_PHONE_ID =", process.env.META_PHONE_ID);
console.log(
  "META_ACCESS_TOKEN prefix/length =",
  process.env.META_ACCESS_TOKEN?.slice(0, 4),
  process.env.META_ACCESS_TOKEN?.length
);
const waResponse = await fetch(
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

console.log("RESPOSTA META =>", await waResponse.text());
