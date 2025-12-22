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

async function fetchShopify(query, variables = {}) {
  try {
    const response = await fetch(SHOPIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token":
          process.env.SHOPIFY_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error("❌ Shopify GraphQL errors:", data.errors);
      return null;
    }

    return data.data;
  } catch (err) {
    console.error("❌ Shopify fetch failed:", err);
    return null;
  }
}

async function getProducts() {
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

  const data = await fetchShopify(query);

  if (!data || !data.products) {
    return null;
  }

  return data.products.edges.map(e => ({
    title: e.node.title,
    price: `${e.node.priceRange.minVariantPrice.amount} ${e.node.priceRange.minVariantPrice.currencyCode}`,
    available: e.node.availableForSale,
    url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${e.node.handle}`
  }));
}

/* ================= SESSION MEMORY ================= */
const sessions = {};
const MAX_HISTORY = 12;

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

Tono:
- Joven, creativo, amistoso
- Profesional y claro
- NO agresivo
- NO insistente

Reglas clave:
- Solo ayudas cuando el cliente lo pide
- Si hay intención de compra, guías con claridad
- Nunca presionas para vender
- Nunca inventas información
- Si no sabes algo, lo dices

Casos sensibles (OBLIGATORIO):
Si detectas suicidio, depresión severa, peligro inminente,
pobreza extrema o crisis emocional:
- DETENTE inmediatamente
- No intentes ayudar
- Di que un agente humano dará seguimiento

Productos:
- Usas SOLO datos reales de Shopify
- No mencionas lámparas inteligentes
- Respondes SIEMPRE en español
`;

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    const sid = sessionId || "default";

    if (!sessions[sid]) {
      sessions[sid] = [{ role: "system", content: SYSTEM_PROMPT }];
    }

    // intención de compra
    const wantsProducts =
      /precio|comprar|producto|tienda|recomienda|disponible|venta|link|enlace/i.test(
        message
      );

    if (wantsProducts) {
      const products = await getProducts();

      if (products) {
        const productContext =
          "Productos disponibles:\n" +
          products
            .map(
              p =>
                `- ${p.title} | ${p.price} | ${
                  p.available ? "Disponible" : "No disponible"
                } | ${p.url}`
            )
            .join("\n");

        sessions[sid].push({
          role: "system",
          content: productContext,
        });
      } else {
        sessions[sid].push({
          role: "system",
          content:
            "En este momento no pude obtener el catálogo. Si el cliente desea, ofrece ayuda general sin links.",
        });
      }
    }

    sessions[sid].push({ role: "user", content: message });

    // recortar historial
    if (sessions[sid].length > MAX_HISTORY) {
      sessions[sid] = [
        sessions[sid][0],
        ...sessions[sid].slice(-MAX_HISTORY),
      ];
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: sessions[sid],
      temperature: 0.6,
    });

    const reply = completion.choices[0].message.content;

    sessions[sid].push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    res.status(500).json({
      reply:
        "Ahora mismo no pude responder correctamente. Un agente humano puede ayudarte en breve.",
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Kanopy Chat Backend activo en puerto ${PORT}`);
});
