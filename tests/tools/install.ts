import { cloudInitSchema, ensureTool } from "./fetch";
import { CROSSPLANE_CLI, KUBECONFORM } from "./pins";

for (const artifact of [CROSSPLANE_CLI, KUBECONFORM]) {
  console.log(`${artifact.name} ${artifact.version} → ${await ensureTool(artifact)}`);
}
await cloudInitSchema();
console.log("cloud-init schema cached");
