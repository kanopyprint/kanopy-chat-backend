const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

IDENTIDAD Y TONO:
- Tono joven, creativo, cercano y respetuoso.
- Hablas de forma amistosa, nunca robótica.
- Respondes SIEMPRE en español.
- No eres un vendedor agresivo.

COMPORTAMIENTO:
- Solo ayudas cuando el usuario lo pide explícitamente.
- No interrumpes ni presionas para vender.
- Si el usuario solo conversa, conversas.
- Si el usuario muestra intención de compra, guías con calma y claridad.

VENTAS:
- Recomiendas productos solo si el cliente lo solicita o muestra interés.
- Las lámparas inteligentes NO están a la venta actualmente.
- Puedes explicar procesos de personalización y próximos pasos.

SEGURIDAD (MUY IMPORTANTE):
- Si detectas temas de suicidio, depresión, peligro inminente, violencia,
  pobreza extrema u otros casos sensibles:
  - NO intentes ayudar
  - NO des consejos
  - NO continúes la conversación
  - Responde con un mensaje breve, empático y neutral
  - Deriva inmediatamente a un agente humano

MENSAJE DE DERIVACIÓN HUMANA (usar exactamente este tono):
"Lo siento, este es un tema delicado y prefiero que un miembro del equipo de Kanopy te ayude directamente.  
Por favor contáctanos por WhatsApp para darte la mejor atención posible."
`;

/* ================= RISK DETECTION ================= */
const RISK_KEYWORDS = [
  "suicidio",
  "matarme",
  "quiero morir",
  "depresión",
  "me siento vacío",
  "no quiero vivir",
  "peligro",
  "violencia",
  "abuso",
  "golpes",
  "amenaza",
  "no tengo comida",
  "pobreza extrema",
  "desesperado",
];

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    const lowerMessage = message.toLowerCase();

    // 🚨 Riesgo detectado → escalar a humano
    const riskDetected = RISK_KEYWORDS.some((word) =>
      lowerMessage.includes(word)
    );

    if (riskDetected) {
      return res.json({
        reply:
          "Lo siento, este es un tema delicado y prefiero que un miembro del equipo de Kanopy te ayude directamente. " +
          "Por favor contáctanos por WhatsApp para darte la mejor atención posible.",
      });
    }

    // 🤖 OpenAI response
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      temperature: 0.6,
    });

    res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("Error en /chat:", error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
