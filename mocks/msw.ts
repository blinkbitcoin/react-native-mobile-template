import { execute, parse } from 'graphql';
import { HttpResponse, http } from 'msw';
import { contextFromHeaders, createSchema } from './executable-schema';

export function createHandlers(url = 'http://localhost/graphql') {
  const schema = createSchema();
  return [
    http.post(url, async ({ request }) => {
      const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
      const result = await execute({
        schema,
        document: parse(body.query),
        variableValues: body.variables,
        contextValue: contextFromHeaders(request.headers),
      });
      return HttpResponse.json(result);
    }),
  ];
}
