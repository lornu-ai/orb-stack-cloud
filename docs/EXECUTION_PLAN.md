# Revised engineering execution plan

| Link | Issue |
| --- | --- |
| Solution architecture | [#1](https://github.com/stevedores-org/orb-stack-cloud/issues/1) |
| Original epics (Terraform era) | [#2](https://github.com/stevedores-org/orb-stack-cloud/issues/2) |
| **This document (canonical)** | [#5](https://github.com/stevedores-org/orb-stack-cloud/issues/5) |

**Repository tracker:** [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) · **Operator guides:** [CROSSPLANE.md](./CROSSPLANE.md) · [TAILSCALE.md](./TAILSCALE.md) · [CLOUDFLARE.md](./CLOUDFLARE.md)

---

This revised engineering execution plan updates the **OrbStack-Powered "Personal Cloud" Solution Architecture** to replace Terraform/OpenTofu with **Crossplane** as the Kubernetes-native Infrastructure-as-Code (IaC) control plane, while integrating **Tailscale** for zero-trust mesh networking (Tailnet) and **Cloudflare** (Cloudflare Tunnels / Zero Trust / DNS) for secure public edge ingress.

---

## 1. Revised Reference "Local Cloud" Topology (Crossplane, Tailscale & Cloudflare)

By embedding **Crossplane** inside the built-in OrbStack Kubernetes cluster, the Mac's K8s control plane becomes a true cloud provider API. Developers apply Kubernetes Custom Resource Definitions (CRDs/Claims) to declaratively provision local `cloud-init` Linux VMs, LocalStack AWS resources, **Cloudflare Tunnels (`cloudflared`)**, and **Tailscale mesh routes**.

```
       [ Public Edge / Webhooks ]                     [ Remote Teammates / Mobile / CI ]
                   |                                                  |
     Cloudflare Zero Trust Edge                             Tailscale WireGuard Mesh
    (https://app.dev.example.com)                          (MagicDNS: *.tailnet.ts.net)
                   |                                                  |
                   v                                                  v
+------------------+--------------------------------------------------+--------------------+
|                  |           ORBSTACK VIRTUAL VPC NETWORK           |                    |
|                  |    (Unified L2/L3 Bridge + .orb.local DNS Mesh)  |                    |
|                  v                                                  v                    |
|  +----------------------------------------+       +-----------------------------------+  |
|  | TIER 1: KUBERNETES & CROSSPLANE        |       | TIER 2: DOCKER COMPOSE (ROSETTA)  |  |
|  |                                        |       |                                   |  |
|  |  [Crossplane Control Plane (IaC)]      |       |  [billing.internal.orb.local]     |  |
|  |   +-- provider-cloudflare (Tunnels/DNS)|       |   +-- Legacy Billing (linux/amd64)|  |
|  |   +-- provider-aws (-> LocalStack)     |       |       (Rosetta 2 AOT/JIT)         |  |
|  |   +-- OrbMachine XRD (-> cloud-init VM)|       |                                   |  |
|  |                                        |       |  [s3.aws.orb.local@4566]          |  |
|  |  [cloudflared]  [Tailscale Operator]   |       |   +-- LocalStack AWS (linux/arm64)|  |
|  |  [Ingress: *.k8s.orb.local]            |       |       (Provisioned by Crossplane) |  |
|  |   +-- API Gateway & Auth (arm64)       |       +-----------------+-----------------+  |
|  +--------------------+-------------------+                         |                    |
|                       |                                             |                    |
|                       +----------------------+----------------------+                    |
|                                              |                                           |
|                   Internal DNS Routing       |  (postgres.orb.local / vault.orb.local)   |
|                                              v                                           |
|  +------------------------------------------------------------------------------------+  |
|  | TIER 3: STATEFUL LINUX MACHINES (Provisioned via Crossplane XRDs + cloud-init)     |  |
|  |                                                                                    |  |
|  |  +------------------------------------------+  +--------------------------------+  |  |
|  |  | Machine: postgres.orb.local (Ubuntu 24)  |  | Machine: vault.orb.local       |  |  |
|  |  | - Reconciled by Crossplane Composition   |  | - Reconciled by Crossplane     |  |  |
|  |  | - Bootstrapped via cloud-init.yml        |  | - Runs systemd Vault + Consul  |  |  |
|  |  | - Joins Tailnet via tailscaled (/dev/tun)|  | - Joins Tailnet + ssh@orb      |  |  |
|  |  +------------------------------------------+  +--------------------------------+  |  |
|  +------------------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------------------+
```

---

## 2. Program Personas

1. **Hypervisor / Kernel Engineer (`@KernelEng`):** Builds the `Virtualization.framework` host bridge, custom Linux 6.x kernel (including native WireGuard/`/dev/net/tun` modules for Tailscale), eBPF hooks, and Virtio drivers.
2. **Systems / Networking Engineer (`@NetEng`):** Implements the user-space NAT engine, L2/L3 bridge, `/etc/resolver` DNS integration, L7 Auto-TLS proxy, and host coexistence with Tailscale MagicDNS and Cloudflare WARP.
3. **Platform / Runtime Engineer (`@RuntimeEng`):** Develops the container/machine lifecycle manager, `cloud-init` injector, SSH multiplexer (`ssh@orb`), and native Swift menu bar/CLI control plane.
4. **Cloud / Platform Architect (`@CloudArch`):** Designs **Crossplane** Composite Resource Definitions (XRDs) and Compositions, **Tailscale** overlay mesh policies, and **Cloudflare Zero Trust** edge tunnels.
5. **Application Developer (`@AppDev`):** Builds, tests, and debugs polyglot `arm64` and `amd64` microservices locally via Kubernetes Claims and `.orb.local` domains.

---

## 3. Track A: Platform Engine Architecture (Under the Hood)

### EPIC 1: Shared-Kernel Micro-VM & Dynamic Resource Engine
**Objective:** Engineer the single micro-VM hypervisor layer on Apple `Virtualization.framework` and the custom-tuned Linux 6.x guest kernel supporting <0.1% idle CPU, elastic RAM ballooning, APFS sparse storage, and kernel-native WireGuard tunneling for Tailscale.

#### Story 1.1: Custom-Tuned Tickless Linux 6.x Guest Kernel with Native WireGuard & TUN Support
* **As a** `@KernelEng`
* **I want to** boot a minimal ARM64 Linux 6.x kernel via `Virtualization.framework` with tickless idle (`CONFIG_NO_HZ_IDLE=y`), eBPF, `cgroups v2`, and native WireGuard/`/dev/net/tun` enabled
* **So that** all guest workloads share one low-overhead kernel capable of running kernel-mode Tailscale (`tailscaled`) inside isolated network namespaces without userspace packet-copy penalties.
* **Technical Tasks:**
  * Configure kernel build with `CONFIG_NO_HZ_IDLE=y`, `CONFIG_CGROUPS=y`, `CONFIG_BPF_SYSCALL=y`, `CONFIG_WIREGUARD=y`, `CONFIG_TUN=y`, and `CONFIG_NETFILTER_XTABLES=y`.
  * Implement Swift/C host hypervisor wrapper using `VZVirtualMachineConfiguration` and `VZLinuxBootLoader`.
  * Ensure `/dev/net/tun` device nodes are safely creatable inside unprivileged Linux Machine namespaces and Kubernetes pods for Tailscale sidecars.
* **Acceptance Criteria:**
  * **Given** the micro-VM is booted with no active workloads, **When** monitoring the host process over 15 minutes, **Then** host CPU utilization remains `< 0.1%`.
  * **Given** a Linux machine or K8s pod running `tailscaled`, **When** it initializes its tunnel interface, **Then** it binds directly to kernel-mode `/dev/net/tun` and WireGuard rather than falling back to slow userspace networking.
* **Story Points:** 8 | **Priority:** P0

#### Story 1.2: Proactive Memory Ballooning & Free Page Reporting
* **As a** `@AppDev`
* **I want** the Linux guest VM to dynamically claim macOS Unified Memory on demand and release freed memory pages back to macOS immediately when Crossplane controllers, containers, or VMs stop
* **So that** my Mac never suffers from locked static RAM allocations.
* **Technical Tasks:**
  * Configure `VZVirtioTraditionalMemoryBalloonDeviceConfiguration` on macOS.
  * Enable `CONFIG_VIRTIO_BALLOON=y` and **Virtio Free Page Reporting** in the guest kernel.
  * Build a guest memory monitor daemon that triggers proactive Linux page-cache drops and balloon inflation upon container/machine termination.
* **Acceptance Criteria:**
  * **Given** a workload allocates 6 GB of RAM and is stopped, **When** 10 seconds have elapsed, **Then** at least 90% of freed physical pages are returned to the macOS Unified Memory free pool (`vm_stat`).
* **Story Points:** 8 | **Priority:** P0

#### Story 1.3: APFS Sparse Block Device with Live `TRIM`/`discard` Passthrough
* **As a** `@AppDev`
* **I want** all VM and container storage to reside on an elastic APFS sparse image that automatically shrinks on the host when files, images, or Crossplane-provisioned VMs are deleted
* **So that** deleting workloads immediately reclaims macOS SSD space without manual compaction.
* **Technical Tasks:**
  * Provision the guest data disk as an APFS sparse file (`< 10 MB` initial footprint, up to `8 TB` logical limit).
  * Configure `virtio-blk` with `discard` / `TRIM` unmap passthrough mapped to macOS APFS `F_PUNCHHOLE`.
  * Trigger automatic `fstrim` operations on machine or container deletion events.
* **Acceptance Criteria:**
  * **Given** a 10 GB database volume is created and subsequently deleted via a Crossplane Claim deletion, **When** `fstrim` completes, **Then** the physical size of the APFS sparse file on macOS shrinks by ~10 GB within 5 seconds.
* **Story Points:** 5 | **Priority:** P0

#### Story 1.4: High-Throughput Cached `VirtioFS` & Bidirectional File Watcher Bridge
* **As a** `@AppDev`
* **I want** macOS host directories (`/Users/...`) mounted into containers and Linux machines via a dynamically cached `VirtioFS` layer with full `FSEvents`-to-`inotify` translation
* **So that** source code builds run at near-native SSD speeds and hot-reload servers trigger instantaneously.
* **Technical Tasks:**
  * Implement custom `VirtioFS` dentry and page-cache coherency layer.
  * Bridge macOS `FSEvents` to guest VFS `inotify`/`fsnotify` over `virtio-vsock`.
  * Expose guest Linux machine filesystems in macOS Finder under `~/OrbStack/<machine-name>`.
* **Acceptance Criteria:**
  * **Given** a repository bind-mounted from `/Users/dev/project`, **When** a file is saved on macOS, **Then** `inotifywait` inside the container receives the `MODIFY` event in `< 10ms`.
* **Story Points:** 13 | **Priority:** P0

---

### EPIC 2: Multi-Tenant Compute Plane (Linux Machines, Docker & Crossplane-Ready K8s)
**Objective:** Enable concurrent execution of full init-backed Linux distributions, Docker containers, and an integrated Kubernetes cluster that hosts the Crossplane control plane and shares the `containerd` image store.

#### Story 2.1: Namespace-Isolated Linux Machines with Native `PID 1` Init (`systemd`/`OpenRC`)
* **As a** `@RuntimeEng`
* **I want to** provision full Linux distribution root filesystems (Ubuntu, Debian, Fedora, Alpine) inside isolated Linux namespaces booting their real init system as `PID 1`
* **So that** stateful workloads and `systemd` units (PostgreSQL, Vault, `tailscaled`, `cloudflared`) boot in ~250ms with minimal RAM overhead.
* **Technical Tasks:**
  * Build the Linux Machine lifecycle daemon in Rust/Go inside the guest VM.
  * Construct rootfs image downloader and overlay cloning engine for Ubuntu, Debian, Fedora, and Alpine.
  * Configure namespace sandboxing (`cgroups v2` delegation, `/sys/fs/cgroup`, `/dev/net/tun` access) so `systemd` boots cleanly as `PID 1`.
* **Acceptance Criteria:**
  * **Given** a cached Ubuntu rootfs image, **When** `orb create ubuntu test-vm` runs, **Then** the machine reaches `systemctl is-system-running` in `< 300ms` with `< 35 MB` baseline RSS overhead.
* **Story Points:** 13 | **Priority:** P0

#### Story 2.2: Native Docker Engine & `virtio-vsock` Socket Proxy
* **As a** `@AppDev`
* **I want** `/var/run/docker.sock` inside the Linux guest bridged directly to macOS over `virtio-vsock`
* **So that** standard `docker` and `docker compose` CLI workflows execute natively without translation latency.
* **Technical Tasks:**
  * Package `containerd` and `dockerd` inside the shared guest VM.
  * Bridge macOS `~/.orbstack/run/docker.sock` (and `/var/run/docker.sock`) to guest `dockerd` over `virtio-vsock`.
* **Acceptance Criteria:**
  * **Given** the macOS terminal, **When** running `docker compose up -d`, **Then** containers start directly on the guest `dockerd` without TCP port exposure.
* **Story Points:** 5 | **Priority:** P0

#### Story 2.3: Integrated Kubernetes Engine with Shared `containerd` Store & Crossplane Readiness
* **As a** `@CloudArch`
* **I want** the built-in Kubernetes cluster to share the Docker `containerd` image store and support Custom Resource Definitions (CRDs) and webhook admission controllers out-of-the-box
* **So that** locally built Docker images (`imagePullPolicy: Never`) and the **Crossplane** universal control plane run natively with zero external registry dependencies.
* **Technical Tasks:**
  * Embed a lightweight Kubernetes control plane inside the guest VM attached to `/run/containerd/containerd.sock`.
  * Tune kube-apiserver and etcd resource profiles so running Crossplane CRDs/Providers adds minimal CPU overhead when reconciliation loops are idle.
  * Auto-merge the `orbstack` context into `~/.kube/config` on macOS.
* **Acceptance Criteria:**
  * **Given** a locally built image (`docker build -t my-controller:dev .`), **When** referenced by a K8s Deployment or Crossplane Function with `imagePullPolicy: Never`, **Then** the pod starts in `< 2 seconds` without pulling from a registry.
* **Story Points:** 8 | **Priority:** P0

---

### EPIC 3: Virtual VPC Networking, Tailscale Mesh & Cloudflare Edge Integration
**Objective:** Build a 45 Gbps user-space virtual network stack with automatic `*.orb.local` DNS, Auto-TLS ingress, seamless coexistence with **Tailscale MagicDNS** and **Cloudflare WARP**, and built-in routing for Tailscale subnet exposure and Cloudflare Tunnels.

#### Story 3.1: Unified L2/L3 Virtual Bridge & High-Speed `Virtio-Net` Data Plane
* **As a** `@NetEng`
* **I want** Docker containers, Linux machines (`eth0`), and Kubernetes `ClusterIP`/`Pod` subnets connected across a unified virtual L2/L3 bridge backed by a 45 Gbps `Virtio-Net` data plane
* **So that** Crossplane providers running in Kubernetes can directly reach Linux machines (`postgres.orb.local`) and Compose services (`s3.aws.orb.local`) at memory-bus speeds.
* **Technical Tasks:**
  * Implement the macOS user-space virtual switch paired with `VZVirtioNetworkDeviceConfiguration`.
  * Configure guest routing tables so Docker bridge networks, Linux Machine veth pairs, and Kubernetes CNI subnets are mutually routable without NAT hairpinning.
* **Acceptance Criteria:**
  * **Given** `iperf3` running between macOS and the Linux guest, **When** testing TCP throughput, **Then** bandwidth exceeds `35–45 Gbps` and cross-tier ping latency is `< 0.5ms`.
* **Story Points:** 13 | **Priority:** P0

#### Story 3.2: Scoped macOS DNS Resolver & Dynamic `.orb.local` Service Discovery
* **As a** `@AppDev`
* **I want** every container, Compose service, Linux machine, and K8s service to automatically receive a `.orb.local` or `.k8s.orb.local` domain name
* **So that** Crossplane providers, microservices, and my macOS browser can address any local cloud resource by name without port collisions.
* **Technical Tasks:**
  * Configure `/etc/resolver/orb.local` on macOS pointing to the embedded DNS server.
  * Dynamically register/deregister A/AAAA records on Docker, Linux machine, and K8s Service lifecycle events, respecting `dev.orbstack.domains` labels.
* **Acceptance Criteria:**
  * **Given** a Linux machine named `postgres` or Compose service labeled `dev.orbstack.domains=s3.aws.orb.local@4566`, **When** queried via `dig` from macOS, a K8s Crossplane pod, or another VM, **Then** the virtual IP resolves within `100ms`.
* **Story Points:** 8 | **Priority:** P0

#### Story 3.3: eBPF Socket Detection & Zero-Config Auto-TLS L7 Reverse Proxy
* **As a** `@AppDev`
* **I want** HTTP ports opened inside any container or Linux machine automatically exposed over `https://<domain>.orb.local` using locally trusted TLS certificates
* **So that** local web apps and APIs work over HTTPS port 443 without `-p` port mappings.
* **Technical Tasks:**
  * Implement eBPF/`netlink` socket listener hooks and the `OrbStack-Server-Detection` HTTP probe inside the guest.
  * Provision a trusted local Root CA in the macOS System Keychain and terminate TLS dynamically in the host L7 ingress proxy.
* **Acceptance Criteria:**
  * **Given** a container listening on internal port `8080` with label `dev.orbstack.domains=billing.internal.orb.local@8080`, **When** accessed at `https://billing.internal.orb.local`, **Then** valid HTTPS traffic routes directly to port `8080`.
* **Story Points:** 13 | **Priority:** P1

#### Story 3.4: Tailscale MagicDNS & Cloudflare WARP Host-Network Coexistence
* **As a** `@NetEng`
* **I want** the macOS user-space NAT and DNS forwarder to seamlessly coexist with host **Tailscale** (`100.100.100.100` MagicDNS) and **Cloudflare WARP** Zero Trust tunnels
* **So that** containers and Linux machines can resolve remote `*.ts.net` Tailnet hosts and Cloudflare Zero Trust private routes without DNS loops or routing table collisions.
* **Technical Tasks:**
  * Implement user-space TCP/UDP/ICMP NAT termination on macOS using host BSD sockets.
  * Subscribe to macOS `SCDynamicStore` DNS changes to detect active Tailscale (`utun`) and Cloudflare WARP interfaces, chaining upstream DNS resolution for `.ts.net` and private corporate zones while preserving `/etc/resolver/orb.local`.
  * Prevent RFC6598 (`100.64.0.0/10` Tailscale CGNAT range) IP collisions when allocating OrbStack virtual bridge subnets.
* **Acceptance Criteria:**
  * **Given** Tailscale and/or Cloudflare WARP is active on the macOS host, **When** a container inside OrbStack runs `curl https://remote-service.tailnet-name.ts.net`, **Then** the DNS query and TCP connection traverse the host's Tailscale/WARP tunnel with zero subnet conflicts.
* **Story Points:** 8 | **Priority:** P1

---

### EPIC 4: Cloud-Init Provisioning, SSH Multiplexing & Crossplane Host Bridge
**Objective:** Enable `cloud-init` bootstrapping for Linux machines (including native `tailscale` and `cloudflared` enrollment) and expose a secure local API/SSH bridge so **Crossplane** running inside Kubernetes can declaratively provision and reconcile OrbStack Linux machines.

#### Story 4.1: `NoCloud` Datasource Seed Injector with Tailscale & Cloudflared Bootstrap Support
* **As a** `@CloudArch`
* **I want to** pass a `#cloud-config` YAML via `orb create <distro> <name> -c user-data.yml` that seeds a `NoCloud` datasource prior to `systemd` boot
* **So that** Linux machines can automatically install packages, configure PostgreSQL/Vault, and run `tailscale up --authkey=...` or `cloudflared service install` on first boot.
* **Technical Tasks:**
  * Extend `orb create` to inject `/var/lib/cloud/seed/nocloud-net/user-data` and `meta-data` before starting `systemd` (`PID 1`).
  * Ensure `cloud-init` network stages wait for the OrbStack virtual bridge interface (`eth0`) and DNS resolver before executing `apt`/`dnf` and Tailscale/Cloudflare registration commands.
* **Acceptance Criteria:**
  * **Given** a `user-data.yml` containing `cloud-init` instructions to install `tailscale` and `postgresql-16`, **When** `orb create ubuntu postgres -c user-data.yml` runs, **Then** `cloud-init status --wait` completes with `status: done` and the node registers on the Tailnet and starts PostgreSQL.
* **Story Points:** 8 | **Priority:** P1

#### Story 4.2: Zero-Config SSH Multiplexer (`ssh@orb`) & Crossplane Machine Provisioning Bridge
* **As a** `@CloudArch`
* **I want** a built-in SSH multiplexer (`ssh <machine>@orb`) and an internal control socket accessible to the Crossplane Kubernetes cluster
* **So that** Crossplane Compositions can declaratively create, inspect, and destroy OrbStack Linux machines (`orb create` / `orb delete`) and Ansible can configure them without managing static SSH keys.
* **Technical Tasks:**
  * Run the host SSH multiplexer (`127.0.0.1:32222`) with automatic `SSH_AUTH_SOCK` agent forwarding and `Host *.orb` configuration.
  * Expose a scoped, RBAC-protected Machine Provisioning API endpoint (`http://host.orb.internal:<port>/v1/machines` or via SSH `host.orb.internal`) that allows a Crossplane provider inside the local K8s cluster to trigger `orb create <distro> <name> -c <cloud-init>` and query machine readiness.
* **Acceptance Criteria:**
  * **Given** a Crossplane controller pod running inside the OrbStack K8s cluster, **When** it reconciles a custom `OrbMachine` resource, **Then** it invokes the host bridge to create/delete the `cloud-init` Linux machine and verifies its state in `< 500ms`.
* **Story Points:** 8 | **Priority:** P1

---

### EPIC 5: Cross-Architecture Compute Engine (Rosetta 2 + `binfmt_misc`)
**Objective:** Execute `linux/amd64` (x86_64) containers and Linux machines on Apple Silicon at near-native speed using hardware-assisted Rosetta 2 translation.

#### Story 5.1: Rosetta 2 Runtime Share & `binfmt_misc` Kernel Registration
* **As a** `@AppDev`
* **I want** `linux/amd64` ELF binaries executed inside Docker containers, K8s pods, or amd64 Linux machines transparently translated by Apple's Rosetta 2 engine
* **So that** x86_64 workloads run 3x–5x faster than QEMU emulation.
* **Technical Tasks:**
  * Mount `VZLinuxRosettaDirectoryShare` into the Linux guest VM with `VZLinuxRosettaAbstractSocketCachingOptions`.
  * Register Rosetta with `/proc/sys/fs/binfmt_misc/register` for `x86_64` ELF binaries (`CF` flags enabled).
* **Acceptance Criteria:**
  * **Given** an Apple Silicon Mac, **When** running a `linux/amd64` container or Linux machine, **Then** `uname -m` returns `x86_64` and processes execute via `rosetta` AOT/JIT translation.
* **Story Points:** 8 | **Priority:** P0

#### Story 5.2: Kernel Syscall Shims & QEMU Fallback Toggle for Rosetta Edge Cases
* **As a** `@KernelEng`
* **I want** guest kernel shims for Rosetta syscall limitations alongside a CLI toggle (`orb config set rosetta false`) to fall back to QEMU
* **So that** low-level `ptrace` or `AVX-512` x86 debugging workflows have a clean fallback path.
* **Technical Tasks:**
  * Implement guest kernel shims for `io_uring` and `prctl` flags under Rosetta.
  * Build live `binfmt_misc` switching between Rosetta 2 and `qemu-x86_64-static` via `orb config set rosetta <true|false>`.
* **Acceptance Criteria:**
  * **Given** `orb config set rosetta false` is executed, **When** an `amd64` binary runs, **Then** `binfmt_misc` seamlessly delegates execution to QEMU without rebooting the VM.
* **Story Points:** 5 | **Priority:** P2

---

### EPIC 6: macOS Native Control Plane, Security Isolation & Operational Guardrails
**Objective:** Deliver the native Swift menu bar UI, `orb` CLI, workload isolation flags, and APFS sparse disk backup guardrails.

#### Story 6.1: Native Swift Menu Bar Application & Unified `orb` CLI
* **As a** `@AppDev`
* **I want** a native Swift macOS menu bar app and `orb` CLI to monitor CPU/RAM usage and manage Linux machines, containers, and the Crossplane-enabled K8s cluster
* **So that** I can control my entire local cloud from the menu bar.
* **Technical Tasks:**
  * Build the native Swift/AppKit menu bar UI showing live RAM/CPU metrics, `.orb.local` quick links, and one-click terminal launchers.
* **Acceptance Criteria:**
  * **Given** the menu bar app is idle in the background, **When** checked in Activity Monitor, **Then** it uses `< 40 MB` RAM and `0.0%` CPU.
* **Story Points:** 8 | **Priority:** P1

#### Story 6.2: Workload Isolation Mode (`--isolated` & `--isolate-network`)
* **As a** `@CloudArch`
* **I want to** launch untrusted Linux machines using `orb create --isolated --isolate-network`
* **So that** untrusted workloads cannot access macOS `/Users` mounts, forwarded SSH agents, or lateral `.orb.local` / Tailnet network interfaces.
* **Technical Tasks:**
  * Strip `VirtioFS` mounts and `SSH_AUTH_SOCK` when `--isolated` is passed.
  * Apply eBPF/nftables bridge isolation rules when `--isolate-network` is passed.
* **Acceptance Criteria:**
  * **Given** a machine launched with `--isolated --isolate-network`, **When** it attempts to read `/Users` or connect to `postgres.orb.local:5432`, **Then** both operations are blocked.
* **Story Points:** 8 | **Priority:** P1

#### Story 6.3: APFS Sparse Image Backup Exclusion Guardrails
* **As a** `@RuntimeEng`
* **I want** `~/Library/Group Containers/*.dev.orbstack` automatically flagged with `NSURLIsExcludedFromBackupKey`
* **So that** backup scanners do not read the 8 TB logical size of the sparse disk image, while infrastructure state remains 100% declarative in Git via Crossplane manifests and `cloud-init`.
* **Technical Tasks:**
  * Apply `NSURLIsExcludedFromBackupKey = true` on sparse image creation and provide `orb export` for explicit VM snapshots.
* **Acceptance Criteria:**
  * **Given** an initialized OrbStack data directory, **When** `tmutil isexcluded` is run, **Then** macOS reports `[Excluded]`.
* **Story Points:** 3 | **Priority:** P2

---

## 4. Track B: Reference "Local Cloud" Topology (Crossplane, Tailscale & Cloudflare Blueprint)

### EPIC 7: Reference "Local Cloud" Blueprint with Crossplane, Tailscale & Cloudflare
**Objective:** Replace static Terraform scripts with a self-healing **Crossplane Control Plane** running inside OrbStack Kubernetes that provisions Tier 3 (`cloud-init` Postgres & Vault Linux VMs), Tier 2 (Rosetta `amd64` + LocalStack AWS resources), **Tailscale** zero-trust mesh access, and **Cloudflare Zero Trust Tunnels** (`cloudflared`) for public edge routing.

#### Story 7.1: Crossplane Universal Control Plane & Custom XRDs (Replacing Terraform)
* **As a** `@CloudArch`
* **I want** Crossplane installed inside the OrbStack Kubernetes cluster with `provider-kubernetes`, `provider-helm`, `provider-upjet-aws` (pointed at LocalStack `s3.aws.orb.local:4566`), `provider-cloudflare`, and an `XOrbMachine` Composite Resource Definition (XRD)
* **So that** developers can provision Linux VMs, S3/SQS queues, and Cloudflare DNS/Tunnels using declarative Kubernetes YAML (`kubectl apply -f`) instead of Terraform state files.
* **Technical Tasks:**
  * Bootstrap Crossplane via Helm on the OrbStack K8s cluster.
  * Configure `ProviderConfig` for `provider-upjet-aws` with custom endpoints (`http://s3.aws.orb.local:4566` and `http://sqs.aws.orb.local:4566`) and `skip_credentials_validation: true`.
  * Author the `XOrbMachine` XRD and Composition (`machines.cloud.orb.local`) that reconciles `orb create --memory <mem> --cpus <cpu> <distro> <name> -c <cloud-init>` via the Epic 4.2 host bridge.
* **Acceptance Criteria:**
  * **Given** Crossplane is running in the local K8s cluster, **When** a developer applies an `OrbMachineClaim` and an AWS `Bucket` / `Queue` Claim, **Then** Crossplane reconciles all resources to `READY=True` and `SYNCED=True` without using Terraform.
* **Story Points:** 13 | **Priority:** P1

#### Story 7.2: Tier 3 — Stateful Linux Machines via Crossplane + `cloud-init` + Tailscale Mesh
* **As a** `@CloudArch`
* **I want** Crossplane Claims (`postgres-db.yaml` and `vault-kms.yaml`) to provision `postgres.orb.local` (Ubuntu 24.04) and `vault.orb.local` (Debian 12) via `cloud-init` and automatically enroll them into our **Tailscale** Tailnet
* **So that** stateful backing services run with native `systemd`, are reachable locally at `*.orb.local`, and are securely accessible to remote teammates or CI runners over Tailscale MagicDNS (`postgres.tailnet.ts.net`).
* **Technical Tasks:**
  * Author `ec2-postgres-userdata.yml` and `vault-userdata.yml` including `cloud-init` steps to install `postgresql-16`, `vault`, `prometheus-node-exporter`, and `tailscale` (`tailscale up --authkey=${TS_AUTHKEY} --ssh --hostname=orb-postgres`).
  * Wrap both `cloud-init` configurations inside Crossplane `XOrbMachine` Compositions so `kubectl apply -f tier3-stateful-claims.yaml` provisions both Linux machines in seconds.
* **Acceptance Criteria:**
  * **Given** `kubectl apply -f tier3-stateful-claims.yaml` is executed, **When** Crossplane reconciles the `XOrbMachine` resources, **Then** `postgres.orb.local:5432` and `vault.orb.local:8200` come online in `< 25 seconds` and appear as connected nodes in the Tailscale admin console with Tailscale SSH enabled.
* **Story Points:** 8 | **Priority:** P1

#### Story 7.3: Tier 2 — Cross-Arch Containers (Rosetta `amd64` + Crossplane-Managed LocalStack)
* **As a** `@AppDev`
* **I want** a Docker Compose stack running `legacy-billing-amd64` (via Rosetta 2) alongside `localstack-aws` (`arm64`), where Crossplane automatically provisions the required S3 buckets and SQS queues inside LocalStack
* **So that** our hybrid x86/ARM container tier and mocked AWS dependencies are continuously reconciled by Crossplane.
* **Technical Tasks:**
  * Author `docker-compose.yml` with `legacy-billing-amd64` (`platform: linux/amd64`, label `dev.orbstack.domains=billing.internal.orb.local@8080`, `DATABASE_URL` pointing to `postgres.orb.local:5432`) and `localstack-aws` (`dev.orbstack.domains=s3.aws.orb.local@4566,sqs.aws.orb.local@4566`).
  * Create Crossplane Composition `XEventBus` that uses `provider-upjet-aws` to create the `billing-events` SQS queue and `invoices-archive` S3 bucket on `s3.aws.orb.local:4566`.
* **Acceptance Criteria:**
  * **Given** `docker compose up -d` is running and the `XEventBus` Claim is applied to K8s, **When** Crossplane finishes reconciliation, **Then** `aws --endpoint-url=https://s3.aws.orb.local s3 ls` shows the `invoices-archive` bucket and `https://billing.internal.orb.local/health` returns `HTTP 200 OK`.
* **Story Points:** 5 | **Priority:** P1

#### Story 7.4: Tier 1 & Edge — K8s Microservices, Cloudflare Zero-Trust Tunnels & Tailscale Operator
* **As a** `@CloudArch`
* **I want** stateless K8s microservices (`api-gateway`, `auth-service`) exposed locally via `https://app.k8s.orb.local`, privately to the team via the **Tailscale Kubernetes Operator**, and publicly for webhook testing via a **Cloudflare Tunnel (`cloudflared`)** provisioned by Crossplane `provider-cloudflare`
* **So that** my MacBook acts as a complete cloud datacenter with local `.orb.local` routing, private mesh routing (`.ts.net`), and Zero-Trust public edge ingress (`*.dev.example.com`).
* **Technical Tasks:**
  * Deploy the **Tailscale Kubernetes Operator** into the OrbStack K8s cluster so K8s `Service` / `Ingress` objects annotated with `tailscale.com/expose: "true"` automatically join the Tailnet.
  * Create a Crossplane `XCloudflareEdgeIngress` Composition using `provider-cloudflare` (and `provider-kubernetes`) that provisions a Cloudflare Zero Trust Tunnel, configures a CNAME record (`app-<dev>.dev.example.com`), and deploys the `cloudflared` connector pod routing traffic to `http://api-gateway.default.svc.cluster.local`.
  * Write an end-to-end validation test verifying traffic from all three entrypoints:
    1. Local: `https://app.k8s.orb.local`
    2. Private Tailnet: `https://orb-api-gateway.<tailnet>.ts.net`
    3. Public Cloudflare Edge: `https://app-<dev>.dev.example.com`
* **Acceptance Criteria:**
  * **Given** all three tiers and Crossplane Claims are deployed on an Apple Silicon Mac, **When** an HTTPS checkout request is sent via either `https://app.k8s.orb.local`, the Tailscale MagicDNS URL, or the Cloudflare Tunnel URL, **Then** the request traverses `cloudflared`/Ingress -> K8s `api-gateway` (`arm64`) -> `vault.orb.local` -> `billing.internal.orb.local` (`amd64` via Rosetta) -> `sqs.aws.orb.local` (Crossplane-provisioned LocalStack) -> `postgres.orb.local` (`cloud-init` VM) and returns `HTTP 200`.
* **Story Points:** 13 | **Priority:** P1

---

## 5. Revised Release Roadmap & Sequencing Matrix

```
Phase 1: Core Micro-VM, WireGuard/TUN Kernel & Storage (Weeks 1-4)
  ├── Story 1.1: Tickless Linux 6.x Kernel (with WireGuard & /dev/net/tun)
  ├── Story 1.2: Virtio-Balloon & Free Page Reporting
  ├── Story 1.3: APFS Sparse Block Device & TRIM Passthrough
  └── Story 1.4: High-Throughput Cached VirtioFS & FSEvents Bridge
         │
         ▼
Phase 2: Multi-Tenant Compute, Rosetta 2 & K8s Foundation (Weeks 5-8)
  ├── Story 2.1: Namespace-Isolated Linux Machines (systemd PID 1)
  ├── Story 2.2: Docker Engine & virtio-vsock Proxy
  ├── Story 5.1: Rosetta 2 Runtime Share & binfmt_misc Registration
  └── Story 2.3: Integrated Kubernetes with Shared containerd Store (Crossplane-Ready)
         │
         ▼
Phase 3: Virtual VPC Networking, Tailscale/WARP Coexistence & Cloud-Init Bridge (Weeks 9-12)
  ├── Story 3.1: Unified L2/L3 Virtual Bridge & 45 Gbps Virtio-Net
  ├── Story 3.2: Scoped macOS DNS Resolver (*.orb.local)
  ├── Story 3.3: eBPF Socket Detection & Auto-TLS Reverse Proxy
  ├── Story 3.4: Tailscale MagicDNS & Cloudflare WARP Host Coexistence
  ├── Story 4.1: Cloud-Init NoCloud Seed Injector (Tailscale/Cloudflared bootstrap)
  └── Story 4.2: SSH Multiplexer (ssh@orb) & Crossplane Host Provisioning Bridge
         │
         ▼
Phase 4: Crossplane IaC Control Plane, Cloudflare Edge & Tailscale Mesh Blueprint (Weeks 13-16)
  ├── Story 6.1, 6.2, 6.3: Swift Menu Bar App, --isolated Mode & Backup Exclusions
  ├── Story 5.2: Rosetta Syscall Shims & QEMU Fallback Toggle
  ├── Story 7.1: Crossplane Control Plane & XOrbMachine / AWS / Cloudflare XRDs
  ├── Story 7.2: Tier 3 Stateful VMs (Postgres & Vault via Crossplane + Tailscale)
  ├── Story 7.3: Tier 2 Hybrid Arch Compose + Crossplane-Managed LocalStack
  └── Story 7.4: Tier 1 K8s Microservices + Cloudflare Zero Trust Tunnel + Tailscale Operator
```

---

## 6. Revised Program-Level Definition of Done (DoD) & NFR Gateways

| Metric / Capability | Target SLA / Benchmark | Verification Method |
| :--- | :--- | :--- |
| **Idle Background CPU (VM Only)** | `< 0.1%` host CPU utilization | Automated 15-minute `powermetrics` sample with VM booted at idle. |
| **Linux Machine Boot Time** | `< 300ms` (warm rootfs cache) | Time from Crossplane `XOrbMachine` trigger to `systemctl is-system-running`. |
| **Memory Reclamation Latency** | `> 90%` freed pages reclaimed in `< 10s` | Allocate 6 GB in guest -> terminate workload -> verify macOS `vm_stat`. |
| **Virtual Network Throughput** | `> 35 Gbps` (Target `45 Gbps`) | `iperf3` TCP stream between macOS host and Linux guest over `Virtio-Net`. |
| **Cross-Arch Execution Speed** | `>= 3x` faster than QEMU user-mode | Run `linux/amd64` billing service benchmark via Rosetta 2 vs. QEMU. |
| **Crossplane IaC Reconciliation** | `100%` Terraform-free provisioning | `kubectl apply -f` provisions `cloud-init` VMs, LocalStack S3/SQS, and Cloudflare Tunnels to `READY=True`. |
| **Tri-Path Ingress Routing** | `100%` reachability across Local, Mesh & Edge | Automated E2E test verifying HTTPS traffic via `.orb.local`, Tailscale `.ts.net`, and Cloudflare `cloudflared` tunnel. |
