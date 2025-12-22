const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ================= OPENAI ================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================= SHOPIFY ================= */
const SHOPIFY_ENDPOINT = `https://${process.env.SHOPIFY_STORE_DOMAIN}/api/2024-01/graphql.json`;

async function getProductsSafe() {
  try {
    const query = `
      query {
        products(first: 6) {
          edges {
            node {
              title
              handle
              availableForSale
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(SHOPIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token":
          process.env.SHOPIFY_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (!data?.data?.products?.edges) return "";

    return (
      "Productos disponibles:\n" +
      data.data.products.edges
        .map(e => {
          const p = e.node;
          return `- ${p.title} | ${p.priceRange.minVariantPrice.amount} ${p.priceRange.minVariantPrice.currencyCode} | ${
            p.availableForSale ? "Disponible" : "No disponible"
          } | https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${p.handle}`;
        })
        .join("\n")
    );
  } catch {
    return "";
  }
}

/* ================= MEMORY ================= */
const sessions = {};

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

Tono:
- Joven, creativo, amistoso
- Profesional y claro
- NO agresivo
- NO insistente

Reglas:
- Solo ayudas cuando el cliente lo pide
- Si hay intención de compra, guías con claridad
- Nunca presionas
- Nunca inventas información

Casos sensibles:
Si detectas suicidio, depresión severa o peligro:
- DETENTE
- Di que un agente humano continuará

Productos:
- Usas SOLO datos reales de Shopify
- Respondes SIEMPRE en español
`;

/* ================= CHAT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    const wantsProducts =
      /precio|comprar|producto|tienda|recomienda|disponible|venta/i.test(
        message
      );

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...sessions[sessionId],
    ];

    if (wantsProducts) {
      const productContext = await getProductsSafe();
      if (productContext) {
        messages.push({
          role: "system",
          content: productContext,
        });
      }
    }

    messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.6,
    });

    const reply = completion.choices[0].message.content;

    sessions[sessionId].push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

    res.json({ reply });
  } catch (err) {
    console.error("ERROR CHAT:", err);
    res.status(500).json({
      error: "No pude responder en este momento.",
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Kanopy Chat activo en puerto ${PORT}`);
});
