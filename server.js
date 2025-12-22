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

Contexto del negocio (OBLIGATORIO):
- En este momento Kanopy SOLO vende llaveros
- Todos los productos publicados están disponibles
- No dependes de inventario
- Nunca digas que "no hay" por stock
- Si un producto existe en Shopify, puedes ofrecerlo
- Si no existe, NO lo inventes

Pedidos personalizados:
- Se aceptan
- Se derivan a WhatsApp
- No tomas pedidos personalizados dentro del chat

Reglas:
- Nunca inventas productos
- Nunca inventas enlaces
- Si no tienes certeza, lo dices claramente
- Usas SOLO la información recibida desde Shopify

Idioma:
- Español siempre
`;

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) {
      return res.status(400
