import type { Route } from './+types/methodology';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Методология — Sigma' },
    { name: 'description', content: 'Как се изчислява рисковият скор (0–100).' },
  ];
}

// No loader and no request-time data → safe to prerender at build time
// (listed in react-router.config.ts). See ADR-0001 §2.
export default function Methodology() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Методология</h1>
      <p className="mt-2 text-gray-600">
        Как се изчислява рисковият скор (0–100) и какво означават сигналите.
      </p>
      <ul className="mt-6 list-disc space-y-2 pl-6">
        <li>
          <strong>Нагласено задание</strong> — ограничителни технически спецификации.
        </li>
        <li>
          <strong>Аномални цени</strong> — отклонение от пазарните стойности.
        </li>
        <li>
          <strong>Липса на конкуренция</strong> — малък брой оферти или единствен участник.
        </li>
        <li>
          <strong>Картелни сигнали</strong> — съвместно явяване на свързани участници.
        </li>
        <li>
          <strong>Процедурни аномалии</strong> — кратки срокове и чести анекси.
        </li>
      </ul>
      <p className="mt-6 text-sm text-gray-500">
        Тази страница е статично пре-рендерирана (prerender) при build.
      </p>
    </main>
  );
}
