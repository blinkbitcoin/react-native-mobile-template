export type Viewer = { id: string; displayName: string };

export function createResolvers(initial: Viewer = { id: 'u1', displayName: 'Ada' }) {
  let viewer = { ...initial };
  return {
    Query: {
      hello: (_: unknown, args: { name?: string | null }) => `Hello, ${args.name ?? 'world'}!`,
      viewer: (_: unknown, __: unknown, ctx: { token?: string | null }) =>
        ctx.token ? viewer : null,
    },
    Mutation: {
      updateDisplayName: (_: unknown, args: { name: string }) => {
        viewer = { ...viewer, displayName: args.name };
        return viewer;
      },
    },
  };
}
