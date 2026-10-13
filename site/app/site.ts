import { SOCIAL_ALT } from "./social-image";

export const SITE_URL = "https://ade.chele.bi";

export const API_ORIGIN = (process.env.ADE_API_ORIGIN ?? "https://api.ade.chele.bi").replace(
  /\/+$/,
  "",
);

export const SOCIAL_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: SOCIAL_ALT,
  type: "image/png",
};
