/**
 * CI: verify Cloudflare API token (Story 7.4 / provider-cloudflare readiness).
 * Skips with exit 0 when CF_API_TOKEN is unset (fork PRs).
 */
const token = process.env.CF_API_TOKEN?.trim();
const zoneName = process.env.CF_ZONE_NAME?.trim();

async function main(): Promise<void> {
  if (!token) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "CF_API_TOKEN not set" }));
    return;
  }

  const verify = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const verifyBody = (await verify.json()) as { success?: boolean; result?: { status?: string } };
  if (!verify.ok || !verifyBody.success) {
    throw new Error(`Cloudflare token verify failed: ${verify.status} ${JSON.stringify(verifyBody)}`);
  }

  let zoneId: string | undefined;
  if (zoneName) {
    const zr = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const zj = (await zr.json()) as { success?: boolean; result?: Array<{ id: string; name: string }> };
    if (!zj.success || !zj.result?.length) {
      throw new Error(`Zone ${zoneName} not found or token lacks Zone:Read`);
    }
    zoneId = zj.result[0]!.id;
  }

  console.log(
    JSON.stringify({
      ok: true,
      tokenStatus: verifyBody.result?.status ?? "active",
      zoneName: zoneName ?? null,
      zoneId: zoneId ?? null,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
