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
      products(first: 20) {
        edges {
          node {
            title
            handle
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

  return data.products.edges.map(e => ({
    title: e.node.title,
    price: `${e.node.priceRange.minVariantPrice.amount} ${e.node.priceRange.minVariantPrice.currencyCode}`,
    url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${e.node.handle}`,
  }));
}

/* ================= SESSION MEMORY ================= */
const sessions = {};
const MAX_HISTORY = 12;

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

FORMATO DE RESPUESTA (OBLIGATORIO):
- NO uses Markdown
- NO uses [texto](link)
- NO inventes etiquetas HTML
- Los links deben ser URLs planas completas (https://...)

REGLA CRÍTICA DE PRODUCTOS:
- SOLO puedes mencionar productos que estén listados explícitamente en el catálogo que se te proporciona
- Si un producto no está en el catálogo, responde: 
  "Actualmente no tenemos ese llavero disponible en la tienda"
- NO inventes nombres, materiales, estilos ni categorías

CONTACTO OFICIAL DE WHATSAPP (ÚNICO Y OBLIGATORIO):
- WhatsApp: https://wa.me/18094400062
- Texto del enlace: "Hablar con un agente por WhatsApp"

CONTACTO OFICIAL DE WHATSAPP (ÚNICO Y OBLIGATORIO):
- WhatsApp: https://wa.me/18094400062
- Texto del enlace: "Hablar con un agente por WhatsApp"

CUÁNDO OFRECER WHATSAPP:
- SOLO cuando el cliente lo solicita explícitamente
- O cuando habla de ayuda personalizada o pedidos especiales
- No lo ofrezcas como link genérico

Contexto del negocio:
- Kanopy SOLO vende llaveros
- Todos los productos publicados están disponibles
- No dependes de inventario
- Nunca digas que no hay stock
- Nunca inventes productos, enlaces ni precios

Pedidos personalizados:
- Se aceptan
- Se derivan a WhatsApp
- No se toman dentro del chat

Reglas:
- Usa SOLO productos reales de Shopify
- Si no existe, dilo con claridad
- Links siempre deben ser reales

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
      /precio|comprar|producto|llavero|tienda|disponible|venta|link|enlace/i.test(
        message
      );

    if (wantsProducts) {
      const products = await getProducts();

      if (products.length > 0) {
        const productContext =
          "Catálogo real de Kanopy (llaveros disponibles):\n" +
          products
            .map(p => `- ${p.title} | ${p.price} | ${p.url}`)
            .join("\n");

        sessions[sid].push({
          role: "system",
          content: productContext,
        });
      } else {
        sessions[sid].push({
          role: "system",
          content:
            "Si el cliente pregunta por productos, indica que el catálogo se está ampliando, sin inventar opciones.",
        });
      }
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
      temperature: 0.2,
    });

    const reply = completion.choices[0].message.content;

    sessions[sid].push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    res.status(500).json({
      reply:
        "Ahora mismo no pude responder correctamente. Un agente humano puede ayudarte.",
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`✅ Kanopy Chat Backend activo en puerto ${PORT}`);
});
