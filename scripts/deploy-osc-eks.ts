#!/usr/bin/env bun
/**
 * Deploy OSC Stitch UI to EKS community-stevedores-org (static ConfigMap + ALB Ingress).
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "web", "dist");
const overlay = join(root, "k8s", "overlays", "prod-eks-community");

const ctx =
  "arn:aws:eks:us-east-2:035409784196:cluster/community-stevedores-org";

await $`kubectl config use-context ${ctx}`.quiet();

console.log("Building web…");
await $`cd ${join(root, "web")} && bun install --frozen-lockfile && bun run build`.quiet();

if (!existsSync(join(dist, "index.html"))) {
  throw new Error(`Missing ${dist}/index.html after build`);
}

console.log("Ensuring namespace stevedores…");
await $`kubectl create namespace stevedores --dry-run=client -o yaml | kubectl apply -f -`.quiet();

console.log("Syncing static assets ConfigMaps…");
const assets = join(dist, "assets");
await $`kubectl create configmap osc-web-static --from-file=index.html=${join(dist, "index.html")} -n stevedores --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -`.quiet();
await $`kubectl create configmap osc-web-assets --from-file=${assets} -n stevedores --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -`.quiet();

console.log("Applying domain ConfigMap…");
await $`kubectl apply -f ${join(root, "iac", "domains", "stevedores.yaml")}`.quiet();

console.log("Applying kustomize overlay…");
const applyOut = await $`kubectl apply -k ${overlay}`.nothrow();
if (applyOut.exitCode !== 0) {
  console.warn(
    "Partial apply (common when ALB webhook has no endpoints or nodes are scaled to zero).",
  );
  console.warn(applyOut.stderr.toString());
}

console.log("\nWaiting for rollout…");
await $`kubectl rollout status deployment/osc-web -n stevedores --timeout=180s`.nothrow();

const ing = await $`kubectl get ingress osc-stevedores -n stevedores -o jsonpath={.status.loadBalancer.ingress[0].hostname}`.quiet();
const host = ing.text().trim();
console.log("\n---");
console.log("Ingress hostname:", host || "(pending — re-run: kubectl get ingress -n stevedores)");
console.log("Add Cloudflare CNAME: osc.stevedores.org →", host || "<ALB-DNS>");
console.log("See docs/DEPLOY.md");
