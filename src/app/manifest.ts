import type { MetadataRoute } from "next";

/**
 * The Web App Manifest (served at /manifest.webmanifest): what lets
 * students "install" Roomie to their home screen and open it full screen,
 * like an app. Icons are built from public/icon.svg by `npm run icons`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Roomie — SRM KTR Flats & Flatmates",
    short_name: "Roomie",
    description:
      "Hinge-style flat and flatmate matching for SRM KTR students in Abode Valley, Estancia, Akshaya, Green Pearl, and Potheri.",
    start_url: "/discover",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF9F6",
    theme_color: "#1A1A1A",
    lang: "en-IN",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
