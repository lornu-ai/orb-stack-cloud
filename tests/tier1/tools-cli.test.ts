import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { FakeBins } from "../lib/fakebin";
import { XRD, claim, COMPOSITION, FUNCTION } from "./fixtures";
import { indexXrds } from "./crossplane";
import { composeConfig, dockerEnv, kustomizeBuild, renderAndValidate } from "./tools";

let fakes: FakeBins | undefined;
const savedDockerHost = process.env.DOCKER_HOST;
afterEach(() => {
  fakes?.restore();
  if (savedDockerHost === undefined) delete process.env.DOCKER_HOST;
  else process.env.DOCKER_HOST = savedDockerHost;
});

const dockerOk = [
  { match: ["context", "inspect"], stdout: "unix:///tmp/orb.sock\n" },
  { match: ["info"], stdout: "27.0\n" },
  { match: ["compose"], code: 0 },
];

describe("kustomizeBuild / composeConfig", () => {
  test("counts built objects and reports build failures", async () => {
    fakes = new FakeBins()
      .add("kubectl", [
        { match: ["kustomize", "good"], stdout: "apiVersion: v1\nkind: Namespace\n---\napiVersion: v1\nkind: Service\n" },
        { match: ["kustomize", "bad"], code: 1 },
      ])
      .activate();
    expect(await kustomizeBuild("good", tmpdir())).toMatchObject({ status: "pass", metrics: { objects: 2 } });
    expect((await kustomizeBuild("bad", tmpdir())).status).toBe("fail");
  });

  test("compose config passes or fails on the CLI's exit code", async () => {
    fakes = new FakeBins().add("docker", [{ match: ["compose", "-f", "bad.yml"], code: 1 }, ...dockerOk]).activate();
    expect((await composeConfig("good.yml", tmpdir())).status).toBe("pass");
    expect((await composeConfig("bad.yml", tmpdir())).status).toBe("fail");
  });
});

describe("dockerEnv", () => {
  test("uses DOCKER_HOST when already set", async () => {
    process.env.DOCKER_HOST = "unix:///already";
    expect(await dockerEnv()).toEqual({});
  });

  test("resolves the active docker context, and gives up when the daemon is down", async () => {
    delete process.env.DOCKER_HOST;
    fakes = new FakeBins().add("docker", dockerOk).activate();
    expect(await dockerEnv()).toEqual({ DOCKER_HOST: "unix:///tmp/orb.sock" });
    fakes.restore();
    fakes = new FakeBins().add("docker", [{ match: ["context", "inspect"], stdout: "unix:///x\n" }, { match: ["info"], code: 1 }]).activate();
    expect(await dockerEnv()).toBeUndefined();
  });
});

describe("renderAndValidate", () => {
  const xrd = indexXrds([XRD])[0]!;
  const input = { claim: claim({ size: "s" }), xrd, composition: COMPOSITION, functions: [FUNCTION], extensions: [XRD] };
  const rendered = "apiVersion: example.orb.local/v1alpha1\nkind: XWidget\n---\napiVersion: kubernetes.crossplane.io/v1alpha2\nkind: Object\n";

  test("passes when render composes resources and validate accepts them", async () => {
    delete process.env.DOCKER_HOST;
    fakes = new FakeBins()
      .add("docker", dockerOk)
      .add("crossplane", [{ match: ["composition", "render"], stdout: rendered }, { match: ["resource", "validate"] }])
      .activate();
    const o = await renderAndValidate(`${fakes.dir}/crossplane`, input);
    expect(o).toMatchObject({ status: "pass", metrics: { composed: 1 } });
    const validateCall = fakes.calls().find((c) => c[0] === "crossplane" && c[1] === "resource");
    expect(validateCall?.at(-1)).toEndWith("rendered.yaml");
  });

  test("fails on render errors, empty output, and validation errors", async () => {
    delete process.env.DOCKER_HOST;
    fakes = new FakeBins().add("docker", dockerOk).add("crossplane", [{ match: ["composition", "render"], code: 1 }]).activate();
    expect((await renderAndValidate(`${fakes.dir}/crossplane`, input)).detail).toContain("render failed");
    fakes.restore();
    fakes = new FakeBins().add("docker", dockerOk).add("crossplane", [{ match: ["composition", "render"], stdout: "apiVersion: a/v1\nkind: XWidget\n" }]).activate();
    expect((await renderAndValidate(`${fakes.dir}/crossplane`, input)).detail).toContain("no composed resources");
    fakes.restore();
    fakes = new FakeBins()
      .add("docker", dockerOk)
      .add("crossplane", [{ match: ["composition", "render"], stdout: rendered }, { match: ["resource", "validate"], stdout: "[x] bad field", code: 1 }])
      .activate();
    expect((await renderAndValidate(`${fakes.dir}/crossplane`, input)).detail).toContain("bad field");
  });

  test("skips when no Docker daemon is reachable", async () => {
    delete process.env.DOCKER_HOST;
    fakes = new FakeBins().add("docker", [{ match: ["context", "inspect"], code: 1 }]).activate();
    expect((await renderAndValidate("crossplane", input)).status).toBe("skip");
  });
});
