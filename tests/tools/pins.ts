export type Platform = "darwin-arm64" | "linux-amd64";

export interface PinnedArtifact {
  name: string;
  version: string;
  /** Per-platform download; `archiveMember` set when the binary ships inside a .tar.gz. */
  platforms: Partial<Record<Platform, { url: string; sha256: string; archiveMember?: string }>>;
}

export const CROSSPLANE_CLI: PinnedArtifact = {
  name: "crossplane",
  version: "v2.5.0",
  platforms: {
    "darwin-arm64": {
      url: "https://cli.crossplane.io/stable/v2.5.0/bin/darwin_arm64/crossplane",
      sha256: "6e0e00370fce82299b931fabee8559eed8a79446172ceb2c24c6d1d76f76fb8c",
    },
    "linux-amd64": {
      url: "https://cli.crossplane.io/stable/v2.5.0/bin/linux_amd64/crossplane",
      sha256: "065dd6b40c9ea5fc71e49900d5c924cc0bec7f58375922ddbde6b402f292347e",
    },
  },
};

export const KUBECONFORM: PinnedArtifact = {
  name: "kubeconform",
  version: "v0.8.0",
  platforms: {
    "darwin-arm64": {
      url: "https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-darwin-arm64.tar.gz",
      sha256: "f84f4dfbebf4a6b0b230385fa065a39ea35e02608c2b50d025dcf64775a69d67",
      archiveMember: "kubeconform",
    },
    "linux-amd64": {
      url: "https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz",
      sha256: "9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883",
      archiveMember: "kubeconform",
    },
  },
};

/** Upstream cloud-config JSON schema, pinned to the cloud-init 26.2 release. */
export const CLOUD_INIT_SCHEMA = {
  version: "26.2",
  url: "https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/config/schemas/schema-cloud-config-v1.json",
  sha256: "a2923d8886201b5478683cf9c6118a00d5603f36d69f8ad899c5b7909c807d63",
};

export function currentPlatform(platform = process.platform, arch = process.arch): Platform {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-amd64";
  throw new Error(`no pinned tools for ${platform}/${arch}`);
}
