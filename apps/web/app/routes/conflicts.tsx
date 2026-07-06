import { Link } from 'react-router';
import { count, money, plural } from '@sigma/shared';
import { getConflictLeaderboard } from '@sigma/db';
import type { Route } from './+types/conflicts';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PageHeader } from '../components/PageHeader';
import { FactsList } from '../components/FactsList';
import { Section, Callout } from '../components/ui';
import { ConflictTable } from '../components/ConflictTable';
import { publicCache } from '../lib/cache';
import { withDbRetry } from '../lib/retry';
import { seoMeta } from '../lib/meta';
import { privateOwnershipHeadline } from '../lib/conflicts';

// Свързани лица — office-holders who declared a private ownership stake in a procurement winner. Every row
// is a PUBLISHED, certainty-1.0 link from a person's own asset declaration, exact-matched to a winner. The
// loader reads private-ownership interest_links only — related_persons_internal (family/PII) is never touched.
export function meta({ matches }: Route.MetaArgs) {
  const tags = seoMeta({
    matches,
    path: '/conflicts',
    title: 'Свързани лица — СИГМА',
    description:
      'Длъжностни лица, декларирали дял в дружества, спечелили обществени поръчки. Само 100% съвпадения.',
  });
  // Names individuals: keep out of search indices until legal sign-off on going public (prod is live).
  tags.push({ name: 'robots', content: 'noindex' });
  return tags;
}

export function headers() {
  return { 'Cache-Control': publicCache(3600) };
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  return withDbRetry(() => getConflictLeaderboard(db, 100));
}

export default function Conflicts({ loaderData: links }: Route.ComponentProps) {
  const headline = privateOwnershipHeadline(links);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Начало', to: '/' }, { label: 'Свързани лица' }]} />
      <main id="main">
        <PageHeader
          kicker="Свързани лица"
          title={
            <>
              Длъжностни лица с <em>дял</em> в компании изпълнители
            </>
          }
          lede="Длъжностни лица, декларирали дял в дружество, спечелило обществена поръчка. Всяка връзка е точно съвпадение между собствената декларация на лицето и регистъра на изпълнителите — не оценка, а факт с посочен източник."
        />

        <Callout title="Как се извежда връзката — и какво не твърди">
          <p className="m-0">
            Основата са <strong>собствените декларации</strong> на лицата пред КПКОНПИ (публичен
            регистър). Името на декларираното дружество (с правната форма) се сравнява{' '}
            <strong>точно</strong> с името на изпълнител, спечелил поръчка — българските фирмени имена
            са национално уникални, затова точното съвпадение е един и същ субект. Показваме{' '}
            <strong>само 100% съвпадения</strong> и <strong>само деклариран дял</strong> (не служебни
            роли). Връзката означава деклариран интерес, а <strong>не</strong> нарушение или конфликт
            по закон. Сигнал за неточност:{' '}
            <Link to="/conflicts/methodology#contest">Методология → Поправки</Link>.
          </p>
        </Callout>

        {links.length === 0 ? (
          <p className="muted">Все още няма публикувани връзки.</p>
        ) : (
          <>
            <FactsList
              label="Обобщение"
              rows={[
                {
                  term: 'Длъжностни лица с деклариран дял',
                  value: count(headline.officialCount),
                },
                {
                  term: 'Връзки към изпълнители',
                  value: `${count(headline.linkCount)} ${plural(headline.linkCount, 'връзка', 'връзки')}`,
                },
                {
                  term: 'Публични средства към техните дружества',
                  value: money(headline.totalEur),
                  sub: 'сбор от договорите на свързаните изпълнители',
                },
              ]}
            />

            <Section
              id="list"
              title="Деклариран дял в компании изпълнители"
              hint="Лица, декларирали дял (или дял и управление) в дружество, спечелило поръчка. Подредени по публичните средства към дружеството."
            >
              <ConflictTable
                links={links}
                caption="Длъжностни лица с деклариран дял в компании изпълнители"
              />
            </Section>
          </>
        )}
      </main>
    </>
  );
}
