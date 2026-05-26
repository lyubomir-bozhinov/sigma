import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('companies', 'routes/companies.tsx'),
  route('companies.csv', 'routes/companies.csv.tsx'),
  route('authorities', 'routes/authorities.tsx'),
  route('authorities.csv', 'routes/authorities.csv.tsx'),
  route('contracts', 'routes/contracts.tsx'),
  route('contracts.csv', 'routes/contracts.csv.tsx'),
  route('methodology', 'routes/methodology.tsx'),
] satisfies RouteConfig;
