/**
 * Соцсети лекторов: список сетей и подписи — один источник.
 *
 * Геометрии иконок здесь нет: SVG-пути живут только в `src/styles/program.css`
 * (`.social-link--<network>` как CSS-маска), поэтому страница не везёт копию
 * пути на каждую ссылку. Astro-разметка и клиент берут отсюда лишь сеть
 * и подпись.
 */

export const SOCIAL_NETWORKS = ["telegram", "linkedin", "youtube", "site"] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Подтверждённая публичная ссылка лектора. */
export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  telegram: "Telegram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  site: "Личный сайт",
};
