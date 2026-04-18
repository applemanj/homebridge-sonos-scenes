import type { HouseholdSnapshot, SonosHouseholdSummary, SonosTransport, TopologySnapshot } from "./types";

export class DiscoveryService {
  private lastSnapshot?: TopologySnapshot;

  constructor(private readonly transport: SonosTransport) {}

  async refresh(): Promise<TopologySnapshot> {
    this.lastSnapshot = await this.transport.discoverTopology();
    return this.lastSnapshot;
  }

  async getSnapshot(): Promise<TopologySnapshot> {
    if (!this.lastSnapshot) {
      return this.refresh();
    }

    return this.lastSnapshot;
  }

  async getHouseholds(): Promise<SonosHouseholdSummary[]> {
    const snapshot = await this.getSnapshot();
    return snapshot.households.map((household) => ({
      id: household.id,
      displayName: household.displayName,
    }));
  }

  findHousehold(snapshot: TopologySnapshot, householdId: string): HouseholdSnapshot | undefined {
    return snapshot.households.find((household) => household.id === householdId);
  }
}
