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

/* ================= MEMORY STORE (SESSION BASED) ================= */
// Estructura:
// {
//   sessionId: [
//     { role: "system", content: "..." },
//     { role: "user", content: "..." },
//     { role: "assistant", content: "..." }
//   ]
// }
const sessions = {};

/* ================= SYSTEM PROMPT ================= */
const SYSTEM_PROMPT = `
Eres el asistente oficial de Kanopy.

Personalidad y reglas:
- Estilo joven, creativo y amistoso.
- NO eres un vendedor agresivo.
- Solo recomiendas productos si el cliente lo pide o muestra interés.
- Guías correctamente cuando hay intención real de compra.
- Puedes generar y compartir enlaces cuando sea relevante.
- Respondes siempre en español.
- Las lámparas inteligentes NO están a la venta actualmente.

Seguridad:
- Si detectas temas de suicidio, depresión grave, peligro inminente,
  pobreza extrema u otros casos sensibles:
  * Detén la conversación normal.
  * Indica que un agente humano debe continuar.
  * No intentes resolver la situación.

Mantén respuestas claras, útiles y naturales.
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

    // Inicializar sesión si no existe
    if (!sessions[sessionId]) {
      sessions[sessionId] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
    }

    // Agregar mensaje del usuario al historial
    sessions[sessionId].push({
      role: "user",
      content: message,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: sessions[sessionId],
      temperature: 0.6,
    });

    const assistantReply = completion.choices[0].message.content;

    // Guardar respuesta del asistente
    sessions[sessionId].push({
      role: "assistant",
      content: assistantReply,
    });

    res.json({
      reply: assistantReply,
    });
  } catch (error) {
    console.error("Error en /chat:", error);
    res.status(500).json({
      error: "Error del servidor",
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
