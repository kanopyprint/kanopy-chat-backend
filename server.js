/* ================= SYSTEM PROMPT BASE ================= */
const SYSTEM_PROMPT_BASE = `
Eres el asistente oficial de Kanopy.

FORMATO DE RESPUESTA (OBLIGATORIO):
- NO uses Markdown (ni asteriscos, ni negritas)
- NO uses [texto](link)
- NO inventes etiquetas HTML
- Los links deben ser URLs planas completas (https://...)

REGLA CRÍTICA DE PRODUCTOS Y MATERIALES:
- Todos nuestros productos son EXCLUSIVAMENTE impresos en 3D.
- NO vendemos NADA de acrílico. Si el cliente pregunta por acrílico, aclara amablemente que solo trabajamos con impresión 3D.
- SOLO puedes mencionar productos que estén listados explícitamente en el catálogo que se te proporciona en este mensaje.
- Si un producto no está en el catálogo, responde: "Actualmente no tenemos ese llavero disponible en la tienda."
- NO inventes nombres, materiales, estilos ni categorías.

CONTACTO OFICIAL DE WHATSAPP (ÚNICO Y OBLIGATORIO):
- WhatsApp: https://wa.me/18094400062
- SOLO ofrécelo cuando el cliente lo solicita explícitamente, para pedidos personalizados, o para asistencia directa. No lo des como un link genérico de despedida.

Contexto del negocio:
- Kanopy SOLO vende llaveros.
- Nunca digas que no hay stock (se fabrican bajo demanda).
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

    // 1. Inicializar historial si no existe (AQUÍ SOLO GUARDAMOS USER Y ASSISTANT)
    if (!sessions[sid]) {
      sessions[sid] = [];
    }

    // 2. Agregar el mensaje actual del usuario al historial puro
    sessions[sid].push({ role: "user", content: message });

    // 3. Mantener el límite de memoria para no exceder tokens
    if (sessions[sid].length > MAX_HISTORY) {
      sessions[sid] = sessions[sid].slice(-MAX_HISTORY);
    }

    // 4. ¿El usuario busca productos? Construimos el contexto DINÁMICAMENTE
    let catalogoContexto = "";
    const wantsProducts = /precio|comprar|producto|llavero|tienda|disponible|venta|link|enlace/i.test(message);

    if (wantsProducts) {
      // Tip: Si tienes más de 20 productos, asegúrate de cambiar "first: 20" a "first: 50" en tu función getProducts()
      const products = await getProducts(); 

      if (products.length > 0) {
        catalogoContexto = "\n\nCatálogo real y actual de Kanopy (llaveros disponibles):\n" +
          products.map(p => `- ${p.title} | ${p.price} | ${p.url}`).join("\n");
      } else {
        catalogoContexto = "\n\nNota interna: El catálogo se está ampliando, indica que por el momento no puedes mostrar los productos sin inventar opciones.";
      }
    }

    // 5. Ensamblamos los mensajes para esta petición ESPECÍFICA.
    // Combinamos el Prompt Base + El Catálogo (si aplica) + El historial limpio.
    const mensajesParaOpenAI = [
      { role: "system", content: SYSTEM_PROMPT_BASE + catalogoContexto },
      ...sessions[sid]
    ];

    // 6. Llamada a la API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Modelo corregido
      messages: mensajesParaOpenAI,
      temperature: 0.2, // Baja temperatura = respuestas lógicas y apegadas al catálogo
    });

    const reply = completion.choices[0].message.content;

    // 7. Guardar la respuesta del bot en el historial puro
    sessions[sid].push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    res.status(500).json({
      reply: "Ahora mismo no pude responder correctamente. Un agente humano puede ayudarte escribiendo al WhatsApp: https://wa.me/18094400062",
    });
  }
});
