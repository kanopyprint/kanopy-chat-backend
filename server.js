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
        "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_STOREFRONT_TOKEN,
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
  // Cambiamos a 250 productos y filtramos solo los que están "Activos"
  const query = `
    query {
      products(first: 250, query: "status:active") {
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

/* ================= SYSTEM PROMPT BASE ================= */
const SYSTEM_PROMPT_BASE = `
Eres el asistente oficial de Kanopy Print.

FORMATO DE RESPUESTA (OBLIGATORIO):
- NO uses Markdown (ni asteriscos, ni negritas).
- NO uses el formato [texto](link).
- NO inventes etiquetas HTML.
- Los links deben ser URLs planas completas (https://...).

REGLA CRÍTICA DE PRODUCTOS Y MATERIALES:
- Todo nuestro catálogo consiste EXCLUSIVAMENTE en productos impresos en 3D.
- BAJO NINGUNA CIRCUNSTANCIA ofrezcas, sugieras o confirmes la existencia de productos de acrílico. Si el cliente pregunta por acrílico, aclara amablemente que solo trabajamos con impresión 3D.
- SOLO puedes mencionar productos que estén listados explícitamente en el catálogo que se te proporciona en este mensaje.
- Si un producto no está en el catálogo, responde: "Actualmente no tenemos ese artículo, pero te invito a revisar nuestro catálogo en kanopyprint.com".
- NO inventes nombres, materiales, estilos ni categorías.
- Cuando el cliente pida sugerencias o pregunte qué productos tienes, evalúa todo el catálogo interno pero SOLO menciona un máximo de 3 o 4 opciones relevantes, e invítalo a ver el resto en la página web.

CONTACTO OFICIAL DE WHATSAPP (ÚNICO Y OBLIGATORIO):
- WhatsApp: https://wa.me/18094400062
- SOLO ofrécelo cuando el cliente lo solicita explícitamente, para pedidos personalizados, o para asistencia directa. No lo ofrezcas como un link genérico de despedida.

Contexto del negocio:
- Kanopy Print SOLO vende artículos impresos en 3D (como llaveros).
- Todos los productos publicados están disponibles. Nunca digas que no hay stock (se fabrican bajo demanda).
- Idioma: Siempre en Español.
`;

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    const sid = sessionId || "default";

    // Inicializar historial si no existe (AQUÍ SOLO GUARDAMOS USER Y ASSISTANT)
    if (!sessions[sid]) {
      sessions[sid] = [];
    }

    // ¿El usuario busca productos? Construimos el contexto DINÁMICAMENTE
    let catalogoContexto = "";
    const wantsProducts = /precio|comprar|producto|llavero|tienda|disponible|venta|link|enlace|catalogo/i.test(message);

    if (wantsProducts) {
      const products = await getProducts(); 

      if (products.length > 0) {
        catalogoContexto = "\n\nCatálogo real y actual de Kanopy Print (productos disponibles):\n" +
          products.map(p => `- ${p.title} | ${p.price} | ${p.url}`).join("\n");
      } else {
        catalogoContexto = "\n\nNota interna: El catálogo se está ampliando, indica que por el momento no puedes mostrar los productos sin inventar opciones.";
      }
    }

    // Ensamblamos los mensajes para esta petición ESPECÍFICA enviando el mensaje actual.
    const mensajesParaOpenAI = [
      { role: "system", content: SYSTEM_PROMPT_BASE + catalogoContexto },
      ...sessions[sid],
      { role: "user", content: message }
    ];

    // Llamada a la API usando el modelo correcto
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajesParaOpenAI,
      temperature: 0.2, // Baja temperatura para evitar alucinaciones
    });

    let reply = completion.choices[0].message.content;

    // Filtro de seguridad: Elimina puntos o comas pegados al final de los enlaces de Shopify o WhatsApp
    reply = reply.replace(/(https?:\/\/[^\s]+)[\.,;]/g, '$1');

    // Guardar la interacción en el historial puro
    sessions[sid].push({ role: "user", content: message });
    sessions[sid].push({ role: "assistant", content: reply });

    // Mantener el límite de memoria
    if (sessions[sid].length > MAX_HISTORY) {
      sessions[sid] = sessions[sid].slice(-MAX_HISTORY);
    }

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    res.status(500).json({
      reply: "Ahora mismo no pude responder correctamente. Un agente humano puede ayudarte escribiendo al WhatsApp: https://wa.me/18094400062",
    });
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`✅ Kanopy Chat Backend activo en puerto ${PORT}`);
});
