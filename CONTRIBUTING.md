# Contributing

meanwhile requires Node.js 20 or newer.

```sh
npm install
npm test
npm run typecheck
npm run bundle
```

Keep pull requests focused. Explain the user-visible behavior and include tests for engine or policy changes.

The project has zero runtime dependencies. Prefer Node.js built-ins; discuss any proposed runtime dependency before adding it.

`dist/meanwhile.mjs` is committed. Rebuild it and include the result in your pull request. CI checks that the committed bundle is reproducible.

New platforms must degrade honestly. If a lifecycle signal or OS capability is unavailable, expose the limitation instead of simulating support or silently changing policy.

Before opening a pull request, confirm:

- `npm test` passes.
- `npm run typecheck` passes.
- `npm run bundle` leaves the committed bundle current.
- Documentation matches the behavior you changed.
