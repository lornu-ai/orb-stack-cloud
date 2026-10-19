export const PUBLIC_ZONE = "stevedores.org";
/** Public hub website, served from infra-code-micro (docs/PUBLIC-SITE.md). Not a tunnel. */
export const HUB_HOST = `osc.${PUBLIC_ZONE}`;
/** Stable Cloudflare Tunnel + Access host into the Mac's api-gateway. */
export const TUNNEL_HOST = `osc-app.${PUBLIC_ZONE}`;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Per-run Cloudflare tunnel host. Kept one label deep so Universal SSL covers it. */
export function prTunnelHost(runId: string, zone = PUBLIC_ZONE): string {
  const host = `osc-pr-${runId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.${zone}`;
  const problem = edgeHostProblem(zone, host);
  if (problem) throw new Error(problem);
  return host;
}

/**
 * Cloudflare Universal SSL covers the apex and one wildcard level only. Returns why a
 * host would not get an edge certificate, or undefined when it would.
 */
export function edgeHostProblem(zone: string, host: string): string | undefined {
  const z = zone.toLowerCase();
  const h = host.toLowerCase();
  if (h !== host) return `${host}: hostnames must be lowercase`;
  if (!h.split(".").every((l) => LABEL.test(l))) return `${host}: not a valid DNS name`;
  if (h === z) return undefined;
  if (!h.endsWith(`.${z}`)) return `${host} is not inside zone ${zone}`;
  const extra = h.slice(0, -(z.length + 1)).split(".").length;
  return extra === 1
    ? undefined
    : `${host} is ${extra} labels below ${zone}; Universal SSL covers only one (use e.g. ${h.split(".")[0]}.${z})`;
}
