// GhostForge: upstream declares these as @colyseus/schema classes. The
// Colyseus server layer is replaced by the snapshot adapter, so only the
// state shapes the scene reads are kept (see ../snapshot-room.ts).
import type { SnapshotAgent, SnapshotAgentMap } from '../snapshot-room';

export type AgentState = SnapshotAgent;

export interface OfficeState {
    agents: SnapshotAgentMap;
    officeTime: string;
    timeScale: number;
}
