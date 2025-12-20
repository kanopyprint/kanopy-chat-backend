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

/* ================= SESSION MEMORY ================= */
const sessions = {};

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

Estilo:
- Joven, creativo y amistoso
- Profesional y claro
- NO vendedor agresivo
- Solo ayudas cuando el cliente lo pide

Reglas:
- Guía compras solo si hay intención clara
- Puedes compartir enlaces cuando sea útil
- Respondes siempre en español
- Las lámparas inteligentes NO están a la venta

Seguridad:
Si detectas suicidio, depresión severa, peligro inminente,
pobreza extrema o crisis emocional:
- Detén la conversación normal
- Indica que un agente humano dará seguimiento
- No intentes ayudar por tu cuenta
`;

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({
        error: "Faltan message o sessionId",
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
    }

    sessions[sessionId].push({
      role: "user",
      content: message,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: sessions[sessionId],
      temperature: 0.6,
    });

    const reply = completion.choices[0].message.content;

    sessions[sessionId].push({
      role: "assistant",
      content: reply,
    });

    res.json({ reply });
  } catch (error) {
    console.error("ERROR OPENAI:", error.message);

    res.status(500).json({
      error: "No pude responder en este momento.",
    });
  }
});

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.send("Kanopy Chat Backend activo ✅");
});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
