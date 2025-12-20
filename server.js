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

/* ================= SYSTEM PROMPT KANOPY ================= */
const SYSTEM_PROMPT = `
Eres Kanopy, una marca creativa que crea piezas personalizadas para regalar y coleccionar.

Hablas como una marca, no como una persona individual.
Tu tono es joven, creativo, claro y respetuoso.
Ayudas solo cuando el cliente lo pide y no empujas ventas.

Nunca enfatizas la tecnología ni mencionas impresión 3D.
Te enfocas en el valor, el diseño y la experiencia.

Puedes:
- Explicar productos y procesos
- Orientar a clientes
- Acompañar paso a paso una compra SOLO si el cliente muestra intención clara

No puedes:
- Confirmar pedidos
- Dar estados de órdenes
- Prometer fechas exactas
- Dar asesoría médica, legal o psicológica
- Involucrarte en crisis personales

USO DE EMOJIS:
- Permitidos solo en mensajes amistosos
- Prohibidos en reclamos o situaciones sensibles

CASOS EXTREMOS:
Si el usuario menciona suicidio, violencia, depresión grave, pobreza extrema o peligro inminente:
- Responde con empatía mínima
- Di que Kanopy no puede ayudar con ese tema
- Deriva a un agente humano
- No continúes la conversación sobre el tema

Respondes siempre en español.
`;

/* ================= DETECCIÓN DE RIESGO ================= */
const dangerKeywords = [
  "suicidio",
  "matarme",
  "no quiero vivir",
  "me quiero morir",
  "depresión",
  "deprimido",
  "violencia",
  "arma",
  "amenaza",
  "no tengo comida",
  "pobreza extrema",
];

function isDanger(message) {
  return dangerKeywords.some((word) =>
    message.toLowerCase().includes(word)
  );
}

/* ================= DETECCIÓN DE INTENCIÓN DE COMPRA ================= */
const buyKeywords = [
  "comprar",
  "precio",
  "pedido",
  "ordenar",
  "envío",
  "me interesa",
  "quiero este",
  "cómo compro",
];

function hasBuyIntent(message) {
  return (
    buyKeywords.filter((word) =>
      message.toLowerCase().includes(word)
    ).length >= 2
  );
}

/* ================= CHAT ENDPOINT ================= */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    /* 🔴 CASOS EXTREMOS: CORTE INMEDIATO */
    if (isDanger(message)) {
      return res.json({
        reply:
          "Lamentamos que estés pasando por una situación así. En Kanopy no podemos ayudar con este tipo de temas, pero es importante que recibas apoyo adecuado. Te recomendamos contactar a un profesional o a alguien de confianza.",
      });
    }

    /* 🟡 DEFINIR MODO */
    const mode = hasBuyIntent(message)
      ? "GUIDED_PURCHASE"
      : "NORMAL_HELP";

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content:
          mode === "GUIDED_PURCHASE"
            ? "El usuario muestra intención clara de compra. Guía paso a paso sin presión."
            : "El usuario busca información general. Ayuda sin intentar vender.",
      },
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.6,
    });

    res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("Error en /chat:", error);
    res.status(500).json({
      reply:
        "Ocurrió un problema al procesar tu mensaje. Nuestro equipo puede ayudarte directamente si lo necesitas.",
    });
  }
});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
