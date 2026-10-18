import { cleanupCiResources, CI_PREFIX } from "./lib/orb";

// Runner hook / always() step. Unlike `orb delete --all`, this never touches machines
// or containers the suite did not create.
const removed = await cleanupCiResources();
console.log(removed.length ? `removed ${removed.length} ${CI_PREFIX}* resources` : `no ${CI_PREFIX}* resources to remove`);
