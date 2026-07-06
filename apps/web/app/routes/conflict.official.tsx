import { Link } from 'react-router';
import { getOfficialConflicts, personIdFromSlug } from '@sigma/db';
import type { Route } from './+types/conflict.official';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PageHeader } from '../components/PageHeader';
import { Section, Callout } from '../components/ui';
import { ConflictTable } from '../components/ConflictTable';
import { publicCache } from '../lib/cache';
import { withDbRetry } from '../lib/retry';
import { seoMeta } from '../lib/meta';

// One official's published conflict links, private ownership separated from ex-officio/management roles.
// Reads interest_links only. 404 (not an empty page) when the official has no published link — a bare page
// under someone's name reads as an unfounded accusation.
export function meta({ data, matches, params }: Route.MetaArgs) {
  const name = data?.official ?? 'Официал';
  const tags = seoMeta({
    matches,
    path: `/conflicts/official/${params.id}`,
    title: `${name} — свързани лица — СИГМА`,
    description: `Декларирани интереси на ${name} в дружества, спечелили обществени поръчки.`,
  });
  tags.push({ name: 'robots', content: 'noindex' }); // named individual — not indexed (delivery plan §E10)
  return tags;
}

export function headers() {
  return { 'Cache-Control': publicCache(3600) };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const personId = personIdFromSlug(params.id);
  if (!personId) throw new Response('Not Found', { status: 404 });
  const db = context.cloudflare.env.DB;
  const data = await withDbRetry(() => getOfficialConflicts(db, personId));
  if (!data) throw new Response('Not Found', { status: 404 });
  return data;
}

export default function ConflictOfficial({ loaderData }: Route.ComponentProps) {
  const { official, privateOwnership, otherRoles } = loaderData;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Начало', to: '/' },
          { label: 'Свързани лица', to: '/conflicts' },
          { label: official },
        ]}
      />
      <main id="main">
        <PageHeader
          kicker="Официал"
          title={official}
          lede="Дружества, спечелили обществени поръчки, в които това лице е декларирало интерес пред КПКОНПИ. Всяка връзка е точно съвпадение по фирмено име — деклариран интерес, не установено нарушение."
        />

        <Callout title="Източник и обхват">
          <p className="m-0">
            Данните са от собствените декларации на лицето (публичен регистър на КПКОНПИ), съпоставени
            точно с регистъра на изпълнителите. Показваме само 100% съвпадения. Сигнал за неточност:{' '}
            <Link to="/conflicts/methodology#contest">Методология → Поправки</Link>.
          </p>
        </Callout>

        {privateOwnership.length > 0 && (
          <Section
            id="private"
            title="Частна собственост"
            hint="Деклариран дял (или дял и управление) в дружество изпълнител."
          >
            <ConflictTable
              links={privateOwnership}
              caption={`Частен дял на ${official} в изпълнители`}
              omit="official"
            />
          </Section>
        )}

        {otherRoles.length > 0 && (
          <Section
            id="roles"
            title="Служебни и управленски роли"
            hint="Декларирано управление без деклариран дял — служебни роли в бордове или управленска позиция. Изведено отделно от частната собственост (ADR-0013)."
          >
            <ConflictTable
              links={otherRoles}
              caption={`Служебни и управленски роли на ${official}`}
              omit="official"
            />
          </Section>
        )}
      </main>
    </>
  );
}
