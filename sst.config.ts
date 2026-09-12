/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST v3/v4 ("Ion") config. `sst diff`/`sst deploy --stage <stage>` is the validation
 * path here (see "Scope note" in DECISIONS.md) -- there's no offline `cdk synth`
 * equivalent, since Pulumi needs AWS credentials to compute a plan.
 *
 * SST requires imports inside `run()` (dynamic `import()`), not top-level static
 * imports -- `sst diff`/`sst dev` refuse to start otherwise ("top level imports -
 * this is not allowed"). Resource definitions themselves live in `infra/resources/`
 * (one file per resource/concern) -- this file just wires them together.
 */
export default $config({
  app(input) {
    return {
      name: 'collegeboard-item-challenge',
      // AccountStage buckets the raw stage; production/staging get retain/protect,
      // everything else (personal dev stages, PR previews) is safe to tear down.
      removal: input.stage === 'production' ? 'retain' : 'remove',
      protect: input.stage === 'production',
      home: 'aws',
    };
  },
  async run() {
    const { resolveAccountStage } = await import('./infra/stage.js');
    const { getStackConfiguration } = await import('./infra/stack-configuration.js');
    const { createExamItemsTable } = await import('./infra/resources/database.js');
    const { createApi } = await import('./infra/resources/api-gateway.js');

    const accountStage = resolveAccountStage($app.stage);
    const stackConfig = getStackConfiguration($app.stage);

    const table = createExamItemsTable();
    const api = createApi({ table, accountStage, stackConfig });

    return {
      api: api.url,
      table: table.name,
    };
  },
});
