// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Private viewer-scoped arbitration for primary, background, and future exclusive raster work.
 * This emitted module is for package maintainers and is not a supported consumer
 * subpath or package-root export. Raster owners retain their own queues and resources.
 * See the [architecture guide](../ARCHITECTURE.md) for rendering ownership boundaries.
 * @packageDocumentation
 * @module raster-work-coordinator
 */

export type PrimaryRasterPressure = "urgent" | "speculative" | "idle";

export interface BackgroundRasterLease {
  readonly revoked: boolean;
  release(): void;
}

interface RasterAdmissionSuspension {
  readonly token: symbol;
  readonly settlement: Promise<void>;
}

interface RasterAdmissionOwner {
  suspendAdmission(): Readonly<RasterAdmissionSuspension>;
  resumeAdmission(token: symbol): void;
}

interface ExclusiveRasterLease {
  readonly released: boolean;
  release(): void;
}

interface MutableLease {
  revoked: boolean;
  released: boolean;
  readonly cancel: () => void;
  readonly settlement: Promise<void>;
  readonly resolve: () => void;
}

interface MutableExclusiveLease {
  released: boolean;
  readonly suspensions: readonly Readonly<{ owner: RasterAdmissionOwner; token: symbol }>[];
}

/** Owns semantic admission and one physically retained, preemptible background lease. */
export class RasterWorkCoordinator {
  #pressure: PrimaryRasterPressure = "idle";
  #renderingActive = true;
  #viewActive = false;
  #stationary = true;
  #transient = false;
  #exclusive: MutableExclusiveLease | null = null;
  #background: MutableLease | null = null;
  #admissionOwners: readonly RasterAdmissionOwner[] = [];
  #changed: (() => void) | null;

  constructor(changed?: () => void) {
    this.#changed = changed ?? null;
  }

  setPrimaryPressure(pressure: PrimaryRasterPressure): void {
    if (this.#pressure === pressure) return;
    this.#pressure = pressure;
    if (pressure === "urgent") this.#revoke();
    this.#changed?.();
  }

  setRenderingActive(active: boolean): void {
    this.#setGate("rendering", active);
  }
  setViewActive(active: boolean): void {
    this.#setGate("view", active);
  }
  setStationary(stationary: boolean): void {
    this.#setGate("stationary", stationary);
  }
  setTransient(active: boolean): void {
    this.#setGate("transient", !active);
  }

  /** Wires the exact raster owners whose admission and physical work exclusivity controls. */
  setAdmissionOwners(...owners: readonly RasterAdmissionOwner[]): void {
    if (this.#exclusive)
      throw new Error("Cannot replace raster admission owners during exclusive work");
    this.#admissionOwners = Object.freeze([...owners]);
  }

  /** Suspends all raster owners and resolves only after captured physical work drains. */
  async acquireExclusive(): Promise<Readonly<ExclusiveRasterLease>> {
    if (this.#exclusive) throw new Error("Exclusive raster work is already acquired");
    const captures = this.#admissionOwners.map(owner => ({
      owner,
      suspension: owner.suspendAdmission(),
    }));
    const state: MutableExclusiveLease = {
      released: false,
      suspensions: Object.freeze(
        captures.map(({ owner, suspension }) =>
          Object.freeze({
            owner,
            token: suspension.token,
          }),
        ),
      ),
    };
    this.#exclusive = state;
    const backgroundSettlement = this.#background?.settlement ?? Promise.resolve();
    this.#revoke();
    this.#changed?.();
    await Promise.allSettled([
      ...captures.map(capture => capture.suspension.settlement),
      backgroundSettlement,
    ]);
    return Object.freeze({
      get released() {
        return state.released;
      },
      release: () => {
        if (state.released) return;
        state.released = true;
        if (this.#exclusive === state) this.#exclusive = null;
        for (const suspension of state.suspensions)
          suspension.owner.resumeAdmission(suspension.token);
        this.#changed?.();
      },
    });
  }

  get canStartBackground(): boolean {
    return (
      this.#renderingActive &&
      this.#viewActive &&
      this.#stationary &&
      !this.#transient &&
      !this.#exclusive &&
      this.#pressure === "idle" &&
      !this.#background
    );
  }

  acquireBackground(cancel: () => void): BackgroundRasterLease | null {
    if (!this.canStartBackground) return null;
    let resolve!: () => void;
    const settlement = new Promise<void>(done => {
      resolve = done;
    });
    const state: MutableLease = { revoked: false, released: false, cancel, settlement, resolve };
    this.#background = state;
    return Object.freeze({
      get revoked() {
        return state.revoked;
      },
      release: () => {
        if (state.released) return;
        state.released = true;
        if (this.#background === state) this.#background = null;
        state.resolve();
        this.#changed?.();
      },
    });
  }

  #setGate(gate: "rendering" | "view" | "stationary" | "transient", allowed: boolean): void {
    const current =
      gate === "rendering"
        ? this.#renderingActive
        : gate === "view"
          ? this.#viewActive
          : gate === "stationary"
            ? this.#stationary
            : !this.#transient;
    if (current === allowed) return;
    if (gate === "rendering") this.#renderingActive = allowed;
    else if (gate === "view") this.#viewActive = allowed;
    else if (gate === "stationary") this.#stationary = allowed;
    else this.#transient = !allowed;
    if (!allowed) this.#revoke();
    this.#changed?.();
  }

  #revoke(): void {
    const lease = this.#background;
    if (!lease || lease.revoked) return;
    lease.revoked = true;
    try {
      lease.cancel();
    } catch {
      /* Physical ownership remains until release. */
    }
  }
}
