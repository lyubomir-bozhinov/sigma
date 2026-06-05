export const DATA_SOURCE = 'AOP/TR via data.egov.bg';

export function withDataSource(response: Response): Response {
  const headers = new Headers(response.headers);
  // Exact licence and attribution copy belongs to the team/legal review; this is a stable source tag.
  headers.set('X-Data-Source', DATA_SOURCE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
