import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { contextFromHeaders, createSchema } from './executable-schema';

const yoga = createYoga({
  schema: createSchema(),
  context: ({ request }) => contextFromHeaders(request.headers),
  graphqlEndpoint: '/graphql',
});
const port = Number(process.env.MOCK_API_PORT ?? 4000);
createServer(yoga).listen(port, () => {
  console.log(`mock GraphQL API on http://localhost:${port}/graphql`);
});
