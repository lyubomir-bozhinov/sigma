import type { Route } from "./+types/home";
import { API_ROUTES } from "@sigma/api-contract";
import { riskBand, type RiskBand } from "@sigma/shared";
import { publicCache } from "../lib/cache";

const SAMPLE_SCORES = [10, 35, 60, 90];

const BAND_COLOR: Record<RiskBand, string> = {
  low: "#2e7d32",
  medium: "#f9a825",
  high: "#ef6c00",
  critical: "#c62828",
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sigma — Прозрачни възлагания" },
    {
      name: "description",
      content: "Платформа за прозрачни обществени възлагания (ППВ).",
    },
  ];
}

// Public, anonymous content → cacheable at the edge (see ADR-0001 §2).
export function headers() {
  return { "Cache-Control": publicCache(300) };
}

export function loader() {
  // Computed on the server (SSR) — proves the loader runs on Cloudflare Workers
  // and that the @sigma/* workspace packages execute server-side.
  const samples = SAMPLE_SCORES.map((score) => ({ score, band: riskBand(score) }));
  return { samples, searchRoute: API_ROUTES.searchTenders };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { samples, searchRoute } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Sigma</h1>
      <p className="mt-2 text-gray-600">
        Платформа за прозрачни обществени възлагания (ППВ).
      </p>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Рисков скор (0–100)</h2>
        <ul className="mt-3 space-y-1">
          {samples.map(({ score, band }) => (
            <li key={score} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: BAND_COLOR[band] }}
              />
              {score} / 100 — {band}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">API</h2>
        <p className="mt-1">
          Търсене на поръчки: <code>{searchRoute}</code>
        </p>
      </section>
    </main>
  );
}
