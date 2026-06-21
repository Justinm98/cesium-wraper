/**
 * One externally-declared covered pair: a satellite (and optionally the
 * specific beam) that the consumer's authoritative data says covers a
 * terminal. Pair granularity matches link-line granularity (FR-A-13: one line
 * per (satellite, terminal) pair).
 */
export interface CoverageLink {
  /** Satellite id covering the terminal (consumer-facing id, NOT namespaced). */
  satelliteId: string;
  /**
   * Optional beam id on that satellite. Recorded for traceability/future use;
   * v2 colors terminals with the single global covered color regardless of
   * which beam (FR-A-17), so beam id does not change v2 coloring.
   */
  beamId?: string;
}

/**
 * Authoritative external coverage for ONE terminal. Presence of the terminal
 * id in the assignment means "this terminal is externally governed" — engine
 * computation is fully suppressed for it (FR-A-12c, per-terminal override). An
 * EMPTY `links` array is meaningful: it asserts "externally known to be
 * covered by nothing" (force-uncovered), distinct from "not externally
 * assigned" (which falls through to engine computation, FR-A-12b).
 */
export interface TerminalCoverageAssignment {
  /** Terminal id this assignment governs (consumer-facing id, NOT namespaced). */
  terminalId: string;
  /** Covered pairs for this terminal. Empty means force-uncovered. */
  links: readonly CoverageLink[];
}

/**
 * The full external coverage-assignment payload (FR-A-12a). Wholesale-replace
 * semantics: the set of terminal ids present here is exactly the set of
 * terminals the engine will NOT compute for. Terminals absent from this list
 * fall through to engine computation (FR-A-12b).
 */
export interface CoverageAssignment {
  /** All externally-governed terminals and their declared coverage. */
  assignments: readonly TerminalCoverageAssignment[];
}
