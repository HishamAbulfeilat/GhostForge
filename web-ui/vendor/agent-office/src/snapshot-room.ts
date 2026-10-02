// GhostForge adapter (not upstream code). Mimics the small slice of the
// colyseus.js client API that agent-office's OfficeScene uses, backed by the
// GhostForge agent snapshot instead of a Colyseus/Ollama server.

export interface AgentFields {
    id: string;
    name: string;
    x: number;
    y: number;
    direction: string;
    action: string;
    currentTask: string;
    thought: string;
    mood: number;
    reputation: number;
    riskLevel: number;
    momentum: number;
}

export type LayoutItem = { id: string; type: string; x: number; y: number; label?: string };

/** How long the vendored scene shows a thought bubble after each change. */
export const THOUGHT_HIDE_MS = 6000;
/**
 * Re-notify period for agents with a current task. It must be shorter than
 * THOUGHT_HIDE_MS; the scene cancels the stale hide on every re-show (see
 * NOTICE.md), so the bubble stays up for as long as the task lasts.
 */
export const THOUGHT_REFRESH_MS = 5000;

export class SnapshotAgent implements AgentFields {
    id = '';
    name = '';
    x = 0;
    y = 0;
    direction = 'down';
    action = 'idle';
    currentTask = '';
    thought = '';
    mood = 0;
    reputation = 0;
    riskLevel = 0;
    momentum = 0;
    private listeners = new Set<() => void>();

    constructor(fields: AgentFields) {
        Object.assign(this, fields);
    }

    onChange(callback: () => void) {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    notify() {
        for (const listener of [...this.listeners]) listener();
    }
}

export class SnapshotAgentMap {
    private items = new Map<string, SnapshotAgent>();
    private addListeners = new Set<(agent: SnapshotAgent, key: string) => void>();
    private removeListeners = new Set<(agent: SnapshotAgent, key: string) => void>();

    get size() { return this.items.size; }
    get(key: string) { return this.items.get(key); }
    values() { return this.items.values(); }
    keys() { return this.items.keys(); }

    // Like Colyseus, registering replays the entries that already exist.
    onAdd(callback: (agent: SnapshotAgent, key: string) => void) {
        this.addListeners.add(callback);
        for (const [key, agent] of [...this.items]) callback(agent, key);
    }

    onRemove(callback: (agent: SnapshotAgent, key: string) => void) {
        this.removeListeners.add(callback);
    }

    add(agent: SnapshotAgent) {
        this.items.set(agent.id, agent);
        for (const listener of [...this.addListeners]) listener(agent, agent.id);
    }

    remove(key: string) {
        const agent = this.items.get(key);
        if (!agent) return;
        this.items.delete(key);
        for (const listener of [...this.removeListeners]) listener(agent, key);
    }
}

type MessageHandler = (message: any) => void;

function sameFields(agent: SnapshotAgent, next: AgentFields) {
    return (Object.keys(next) as Array<keyof AgentFields>).every((key) => agent[key] === next[key]);
}

/** Holds the office state; the host calls update() on every snapshot refresh. */
export class SnapshotOffice {
    readonly state = {
        agents: new SnapshotAgentMap(),
        officeTime: '',
        timeScale: 1,
        toJSON() { return { agents: {}, officeTime: this.officeTime, timeScale: this.timeScale }; },
    };
    private handlers = new Map<string, Set<MessageHandler>>();
    private lastMessages = new Map<string, unknown>();
    private layoutKey = '';
    private timer: ReturnType<typeof setInterval> | null = null;
    private disposed = false;

    readonly room = {
        sessionId: 'ghostforge-snapshot',
        state: this.state,
        onStateChange: {
            once: (callback: (state: any) => void) => {
                queueMicrotask(() => { if (!this.disposed) callback(this.state); });
            },
        },
        onMessage: (type: string, handler: MessageHandler) => {
            const set = this.handlers.get(type) ?? new Set<MessageHandler>();
            set.add(handler);
            this.handlers.set(type, set);
            // Late subscribers still receive the latest layout, as a server would on join.
            if (type === 'layout-sync' && this.lastMessages.has(type)) handler(this.lastMessages.get(type));
        },
        leave: () => {},
    };

    private emit(type: string, message: unknown) {
        this.lastMessages.set(type, message);
        for (const handler of [...(this.handlers.get(type) ?? [])]) handler(message);
    }

    update(agents: AgentFields[], layout: LayoutItem[]) {
        if (this.disposed) return;
        const nextIds = new Set(agents.map((agent) => agent.id));
        for (const key of [...this.state.agents.keys()]) {
            if (!nextIds.has(key)) this.state.agents.remove(key);
        }
        for (const fields of agents) {
            const existing = this.state.agents.get(fields.id);
            if (!existing) {
                this.state.agents.add(new SnapshotAgent(fields));
            } else if (!sameFields(existing, fields)) {
                const taskChanged = existing.currentTask !== fields.currentTask;
                Object.assign(existing, fields);
                existing.notify();
                // Camera follow ("cinematic mode") reacts to highlight events.
                if (taskChanged && fields.currentTask) this.emit('highlight-event', { agentId: fields.id, type: 'task' });
            }
        }
        const nextLayoutKey = JSON.stringify(layout);
        if (nextLayoutKey !== this.layoutKey) {
            this.layoutKey = nextLayoutKey;
            this.emit('layout-sync', { layout });
        }
        this.ensureThoughtRefresh();
    }

    // The scene hides a thought bubble THOUGHT_HIDE_MS after each change;
    // re-notify agents that still have a current task before that happens.
    private ensureThoughtRefresh() {
        if (this.timer || this.disposed) return;
        this.timer = setInterval(() => {
            for (const agent of this.state.agents.values()) {
                if (agent.thought) agent.notify();
            }
        }, THOUGHT_REFRESH_MS);
    }

    dispose() {
        this.disposed = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.handlers.clear();
    }
}

let currentOffice: SnapshotOffice | undefined;

/** Binds the office the next OfficeScene will join. */
export function bindSnapshotOffice(office: SnapshotOffice | undefined) {
    currentOffice = office;
}

/** Unbinds the office, unless a newer office has been bound since. */
export function releaseSnapshotOffice(office: SnapshotOffice) {
    if (currentOffice === office) currentOffice = undefined;
}

export type Room<_State = unknown> = SnapshotOffice['room'];

export class Client {
    // The endpoint is ignored: state comes from the GhostForge snapshot.
    constructor(_endpoint?: string) {}

    async joinOrCreate(_roomName: string): Promise<Room> {
        if (!currentOffice) throw new Error('No GhostForge snapshot office is bound');
        return currentOffice.room;
    }
}
