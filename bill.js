// Общее для страницы счёта и страницы создания: банки, упаковка счёта в ссылку, телефоны.

// [id, название, цвет, ссылка на приложение, сайт].
// Ссылки на приложения проверены на телефоне (test-banks.html) для Т-Банка, Озона и Яндекса;
// для Альфы, ВТБ и Газпромбанка пока стоит общая схема СБП bank<код>://, она может не сработать.
// Сбер на любую ссылку sberbankonline:// просит обновить приложение, поэтому его не открываем:
// кнопка только копирует сумму и показывает подсказку.
const BANKS = [
  ["sber", "Сбер", "#21a038", "", ""],
  ["tbank", "Т-Банк", "#ffdd2d", "bank100000000004://", "https://www.tbank.ru/mybank/payments/"],
  ["alfa", "Альфа", "#ef3124", "bank100000000008://", "https://web.alfabank.ru/"],
  ["vtb", "ВТБ", "#4d7bff", "bank100000000005://", "https://online.vtb.ru/"],
  ["ozon", "Озон Банк", "#005bff", "ozon://finance", "https://finance.ozon.ru/"],
  ["gpb", "Газпромбанк", "#4a8fd8", "bank100000000001://", "https://www.gazprombank.ru/"],
  ["yandex", "Яндекс Банк", "#fc3f1d", "https://bank.yandex.ru/", "https://bank.yandex.ru/"],
  ["other", "Другой банк", "#a397b3", "", ""],
];
const bankName = id => (BANKS.find(b => b[0] === id) || [, id])[1];

// Счёт: {v, t: заведение, s: подпись, p: телефон, b: банк получателя, f: сбор, T: итог чека,
//        i: [[название, кол-во, сумма, группа]]}
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
// "z" — сжато deflate, "j" — без сжатия (для старых браузеров).
async function encodeBill(bill) {
  const raw = new TextEncoder().encode(JSON.stringify(bill));
  if (typeof CompressionStream === "function") return "z" + b64url(await pipeBytes(raw, new CompressionStream("deflate-raw")));
  return "j" + b64url(raw);
}
async function decodeBill(code) {
  const kind = code[0], bytes = unb64url(code.slice(1));
  const raw = kind === "z" ? await pipeBytes(bytes, new DecompressionStream("deflate-raw")) : bytes;
  const bill = JSON.parse(new TextDecoder().decode(raw));
  if (!bill || !Array.isArray(bill.i) || !bill.p) throw new Error("bad bill");
  return bill;
}

// 89224261875 / +7 922 426 18 75 → +79224261875
function normPhone(s) {
  let d = String(s).replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d.length === 11 && d[0] === "7" ? "+" + d : "";
}
const showPhone = p => p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4");
