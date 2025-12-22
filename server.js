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
      products(first: 10) {
        edges {
          node {
            title
            handle
            availableForSale
            productType
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
  if (!data || !data.products) return [];

  // 🔒 SOLO LLAVEROS
  return data.products.edges
    .map(e => e.node)
    .filter(p => /llavero/i.test(p.productType || p.title))
    .map(p => ({
      title: p.title,
      price: `${p.priceRange.minVariantPrice.amount} ${p.priceRange.minVariantPrice.currencyCode}`,
      available: p.availableForSale,
      url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${p.handle}`
    }));
}

/* ================= SESSION MEMORY ================= */
const sessions = {};
const MAX_HISTORY = 12;

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

Contexto del negocio:
- Kanopy vende ACTUALMENTE solo llaveros
- No existen llaveros metálicos ni otros materiales no listados
- El catálogo es pequeño y real
- Nunca inventes productos, materiales, precios o enlaces

Reglas OBLIGATORIAS:
- Solo hablas de productos entregados por el sistema
- Si algo no existe, lo dices claramente
- Nunca escribas "enlace aquí" ni links inventados
- Los links SOLO pueden ser los proporcionados por el sistema
- Para pedidos personalizados:
  - NO inventas opciones
  - Derivas a WhatsApp con un agente humano

Tono:
- Cercano
- Claro
- Honesto
- Sin presión de venta

Idioma:
- Español siempre
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

    const wantsProducts =
      /precio|comprar|producto|llavero|disponible|venta|link|enlace/i.test(
        message
      );

    if (wantsProducts) {
      const products = await getProducts();

      if (products.length > 0) {
        const productContext =
          "Catálogo REAL de llaveros disponibles:\n" +
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
            "Actualmente no hay llaveros disponibles en la tienda. No inventes productos.",
        });
      }
    }

    // pedidos personalizados
    if (/personalizado|custom|a pedido/i.test(message)) {
      sessions[sid].push({
        role: "system",
        content:
          "Para pedidos personalizados, indica que un agente humano puede ayudar vía WhatsApp: https://wa.me/18094400062",
      });
    }

    sessions[sid].push({ role: "user", content: message });

    if (sessions[sid].length > MAX_HISTORY) {
      sessions[sid] = [
        sessions[sid][0],
        ...sessions[sid].slice(-MAX_HISTORY),
      ];
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: sessions[sid],
      temperature: 0.4,
    });

    const reply = completion.choices[0].message.content;
    sessions[sid].push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    res.status(500).json({
      reply:
        "Ahora mismo no pude responder correctamente. Un agente humano puede ayudarte por WhatsApp.",
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Kanopy Chat Backend activo en puerto ${PORT}`);
});
