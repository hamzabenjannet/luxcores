/**
 * Which node runs which match. A match is run by exactly one node. A single server owns every
 * match it starts and needs no registry; with Redis, nodes take a lease per match, so a second
 * node can tell where a match runs and can take over one whose node died.
 */
export abstract class MatchOwnership {
  abstract readonly mode: 'local' | 'redis';
  /** This node's id. */
  abstract readonly nodeId: string;
  /** Takes the match for this node. False when another node holds it. */
  abstract claim(matchId: string): Promise<boolean>;
  /** Gives the match up, so another node can take it at once. */
  abstract release(matchId: string): Promise<void>;
  /** The id of the node that runs the match, or null when none does. */
  abstract ownerOf(matchId: string): Promise<string | null>;
  /** Called when this node must stop running a match because another node holds it now. */
  abstract onLost(listener: (matchId: string) => void): void;
  /** Matches this node holds. */
  abstract held(): string[];
  /** Releases the timers. The leases are released by the match runner as it stops each match. */
  abstract close(): Promise<void>;
}

/** One server on its own: it owns every match it starts. */
export class LocalOwnership extends MatchOwnership {
  readonly mode = 'local' as const;
  private readonly mine = new Set<string>();

  constructor(readonly nodeId: string) {
    super();
  }

  async claim(matchId: string): Promise<boolean> {
    this.mine.add(matchId);
    return true;
  }

  async release(matchId: string): Promise<void> {
    this.mine.delete(matchId);
  }

  async ownerOf(matchId: string): Promise<string | null> {
    return this.mine.has(matchId) ? this.nodeId : null;
  }

  onLost(): void {
    // A lone server cannot lose a match to another node.
  }

  held(): string[] {
    return [...this.mine];
  }

  async close(): Promise<void> {
    this.mine.clear();
  }
}
