/**
 * `/en/program.json` — тот же слепок с переведёнными текстами. Клиентский
 * скрипт модалки и `.ics` читает JSON как готовые строки, поэтому перевод
 * применяется на билде: в браузер не уезжает словарь и логика склейки.
 */
import type { APIRoute } from "astro";
import { localizeProgram } from "../../lib/localize";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(localizeProgram("en")), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
