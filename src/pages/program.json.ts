/**
 * `/program.json` — тот же слепок, что видит билд. Клиентский скрипт читает
 * его для модалки и `.ics`, поэтому эндпоинт пререндерится: ни адаптера,
 * ни запроса к API на каждый просмотр.
 */
import type { APIRoute } from "astro";
import { PROGRAM } from "../lib/program";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(PROGRAM), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
