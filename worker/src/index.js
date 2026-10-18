import Anthropic from "@anthropic-ai/sdk";

// Сайты, которым разрешено обращаться к воркеру.
const ALLOWED_ORIGINS = [
  "https://denis-kharchenko.github.io",
  "http://localhost:8787",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    venue: { type: "string", description: "Название заведения, как в чеке. Пустая строка, если не видно." },
    date: { type: "string", description: "Дата чека в виде ДД.ММ.ГГГГ. Пустая строка, если не видно." },
    table: { type: "string", description: "Номер стола. Пустая строка, если не видно." },
    total: { type: "number", description: "Итоговая сумма чека в рублях (строка «Всего»/«Итого»). 0, если не видно." },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Название позиции нормальным русским текстом: без капса, с нормальным регистром, сокращения раскрыты, если смысл очевиден." },
          qty: { type: "number", description: "Количество из колонки «Кол-во»." },
          sum: { type: "number", description: "Сумма по строке из колонки «Сумма» (за все штуки)." },
          group: { type: "string", enum: ["Напитки", "Еда", "Другое"] },
        },
        required: ["name", "qty", "sum", "group"],
        additionalProperties: false,
      },
    },
  },
  required: ["venue", "date", "table", "total", "items"],
  additionalProperties: false,
};

const PROMPT = `На фото ресторанный или барный чек. Выпиши из него все позиции.

Правила:
- Одна строка чека = одна позиция. Не объединяй и не дели строки.
- qty и sum бери ровно из колонок чека. sum — это сумма по строке, а не цена за штуку.
- Не включай в items итоговые строки, НДС, скидки, сервисный сбор и чаевые.
- Если цифру плохо видно, выбери самое вероятное значение, при котором сумма строк сходится с итогом.
- group: коктейли, пиво, вино, чай, кофе, соки и вода — «Напитки»; блюда, закуски, соусы, десерты — «Еда»; остальное — «Другое».`;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Password",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос с фото чека." }, 405, origin);

    if (!env.APP_PASSWORD || request.headers.get("X-Password") !== env.APP_PASSWORD) {
      return json({ error: "Неверный пароль." }, 401, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "Не удалось прочитать запрос." }, 400, origin); }
    const { image, mediaType } = body || {};
    if (typeof image !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
      return json({ error: "Пришлите фото в формате JPEG, PNG или WebP." }, 400, origin);
    }
    if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Фото слишком большое, максимум 5 МБ." }, 413, origin);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: RECEIPT_SCHEMA },
        },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      });

      if (response.stop_reason === "refusal") return json({ error: "Модель отказалась разбирать это фото." }, 422, origin);
      if (response.stop_reason === "max_tokens") return json({ error: "Чек слишком длинный, ответ обрезался." }, 422, origin);
      const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
      return json(JSON.parse(text), 200, origin);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "Слишком много запросов, попробуйте через минуту." }, 429, origin);
      if (err instanceof Anthropic.AuthenticationError) return json({ error: "На сервере неверный ключ API." }, 500, origin);
      if (err instanceof Anthropic.APIStatusError) return json({ error: `Ошибка Claude API (${err.status}).` }, 502, origin);
      if (err instanceof Anthropic.APIConnectionError) return json({ error: "Не удалось связаться с Claude API." }, 502, origin);
      if (err instanceof SyntaxError) return json({ error: "Модель вернула неразборчивый ответ, попробуйте ещё раз." }, 502, origin);
      throw err;
    }
  },
};
