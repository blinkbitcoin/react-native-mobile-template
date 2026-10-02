import { createServer } from 'node:http';
import { resolvePorts } from '@blinkbitcoin/app-tooling/ports';
import { createYoga } from 'graphql-yoga';
import { contextFromHeaders, createSchema } from './executable-schema';

const yoga = createYoga({
  schema: createSchema(),
  context: ({ request }) => contextFromHeaders(request.headers),
  graphqlEndpoint: '/graphql',
});
// MOCK_API_PORT wins; otherwise APP_PORT_BASE + 2 (the package's ports).
const port = resolvePorts(process.env).mockApi;
createServer(yoga).listen(port, () => {
  console.log(`mock GraphQL API on http://localhost:${port}/graphql`);
});
