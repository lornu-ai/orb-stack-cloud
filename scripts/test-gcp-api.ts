/**
 * CI: optional GCP smoke — uses access token from GHA (google-github-actions/auth) or skips.
 */
async function main(): Promise<void> {
  const projectId = process.env.GCP_PROJECT_ID?.trim();
  const accessToken = process.env.GCP_ACCESS_TOKEN?.trim();

  if (!projectId || !accessToken) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "GCP_PROJECT_ID or GCP_ACCESS_TOKEN not set (configure auth in workflow)",
      }),
    );
    return;
  }

  const pr = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const proj = (await pr.json()) as { name?: string; projectId?: string; error?: { message?: string } };
  if (!pr.ok) {
    throw new Error(`GCP get project failed: ${pr.status} ${proj.error?.message ?? JSON.stringify(proj)}`);
  }

  console.log(JSON.stringify({ ok: true, projectId: proj.projectId ?? projectId, name: proj.name }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
