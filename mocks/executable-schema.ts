import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { createResolvers } from './resolvers';

// Node-only: never import this from src/ — it would pull node:fs into the RN bundle.
const typeDefs = readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8');

export function createSchema() {
  return makeExecutableSchema({ typeDefs, resolvers: createResolvers() });
}

export function contextFromHeaders(headers: { get(name: string): string | null }) {
  const auth = headers.get('authorization');
  return { token: auth?.startsWith('Bearer ') ? auth.slice(7) : null };
}
