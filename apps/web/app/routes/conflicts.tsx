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

// Свързани лица — the conflict-of-interest leaderboard. Every row is a PUBLISHED, certainty-1.0 link built
// from an official's own CACBG declaration exact-matched to a procurement winner (ADR-0001/0013). The loader
// reads interest_links only — related_persons_internal (family/PII) is NEVER touched on this surface (§8).
export function meta({ matches }: Route.MetaArgs) {
  const tags = seoMeta({
    matches,
    path: '/conflicts',
    title: 'Свързани лица — СИГМА',
    description:
      'Официали, декларирали частен дял в дружества, спечелили обществени поръчки. Само 100% съвпадения.',
  });
  // Named individuals + a conflict framing: keep out of search indices until the corrections/appeal page
  // and legal sign-off land (delivery plan §E10). Reachable on-site, not indexed.
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

export default function Conflicts({ loaderData }: Route.ComponentProps) {
  const { privateOwnership, exOfficio } = loaderData;
  const headline = privateOwnershipHeadline(privateOwnership);
  const empty = privateOwnership.length === 0 && exOfficio.length === 0;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Начало', to: '/' }, { label: 'Свързани лица' }]} />
      <main id="main">
        <PageHeader
          kicker="Свързани лица"
          title={
            <>
              Официали с <em>частен дял</em> в изпълнители
            </>
          }
          lede="Публични лица, декларирали дял или управление в дружество, спечелило обществена поръчка. Всяка връзка е точно съвпадение между собствената декларация на лицето и регистър на изпълнителите — не оценка, а факт с посочен източник."
        />

        <Callout title="Как се извежда връзката — и какво не твърди">
          <p className="m-0">
            Основата са <strong>собствените декларации</strong> на лицата пред КПКОНПИ (публичен
            регистър). Името на декларираното дружество (с правната форма) се сравнява{' '}
            <strong>точно</strong> с името на изпълнител, спечелил поръчка — българските фирмени
            имена са национално уникални, затова точното съвпадение е един и същ субект. Показваме{' '}
            <strong>само 100% съвпадения</strong>. Връзката означава деклариран интерес, а{' '}
            <strong>не</strong> нарушение, конфликт по закон или влияние върху конкретна поръчка.
            Сигнал за неточност: <Link to="/methodology#contact">Методология → Поправки</Link>.
          </p>
        </Callout>

        {empty ? (
          <p className="muted">Все още няма публикувани връзки.</p>
        ) : (
          <>
            <FactsList
              label="Обобщение — частна собственост"
              rows={[
                {
                  term: 'Официали с деклариран частен дял',
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
              id="private"
              title={
                <>
                  Частна собственост <em>·</em> водещият сигнал
                </>
              }
              hint="Лица, декларирали дял (или дял и управление) в дружество, спечелило поръчка. Подредени по публичните средства към дружеството."
            >
              {privateOwnership.length > 0 ? (
                <ConflictTable
                  links={privateOwnership}
                  caption="Официали с деклариран частен дял в изпълнители"
                />
              ) : (
                <p className="muted">Няма връзки в тази група.</p>
              )}
            </Section>

            <Section
              id="ex-officio"
              title="Служебни роли в бордове — отделно"
              hint="Управление, декларирано от няколко различни лица за едно и също дружество — признак за назначен обществен борд, не за частен интерес. Изведено отделно, за да не се представя служител като конфликт (ADR-0013)."
            >
              {exOfficio.length > 0 ? (
                <ConflictTable
                  links={exOfficio}
                  caption="Служебни роли в бордове на дружества изпълнители"
                />
              ) : (
                <p className="muted">Няма връзки в тази група.</p>
              )}
            </Section>
          </>
        )}
      </main>
    </>
  );
}
