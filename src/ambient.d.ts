declare module "sonos" {
  export interface SonosBrowseItem {
    id?: string;
    title?: string;
    uri?: string;
    albumArtURI?: string;
  }

  export interface SonosBrowseResult {
    returned: string;
    total: string;
    updateID: string;
    items: SonosBrowseItem[];
  }

  export interface SonosZoneAttrs {
    CurrentZoneName?: string;
    CurrentIcon?: string;
    CurrentConfiguration?: string;
  }

  export interface SonosZoneInfo {
    SerialNumber?: string;
    MACAddress?: string;
    SoftwareVersion?: string;
    DisplayVersion?: string;
    ExtraInfo?: string;
  }

  export interface SonosDeviceDescription {
    modelName?: string;
    displayName?: string;
    roomName?: string;
    serviceList?: {
      service?:
        | {
            serviceType?: string;
            serviceId?: string;
          }
        | Array<{
            serviceType?: string;
            serviceId?: string;
          }>;
    };
  }

  export interface SonosGroupMember {
    UUID?: string;
    ZoneName?: string;
    Location?: string;
    Invisible?: string;
  }

  export interface SonosGroup {
    ID?: string;
    Coordinator?: string;
    Name?: string;
    ZoneGroupMember: SonosGroupMember[];
  }

  export class Sonos {
    constructor(host: string, port?: number);
    host: string;
    port: number;
    getAllGroups(): Promise<SonosGroup[]>;
    getFavorites(): Promise<SonosBrowseResult>;
    getZoneAttrs(): Promise<SonosZoneAttrs>;
    getZoneInfo(): Promise<SonosZoneInfo>;
    deviceDescription(): Promise<SonosDeviceDescription>;
    setAVTransportURI(
      options:
        | string
        | {
            uri: string;
            metadata?: string;
            onlySetUri?: boolean;
          },
    ): Promise<boolean>;
    setVolume(volume: number): Promise<boolean>;
    joinGroup(otherDeviceName: string): Promise<boolean>;
    leaveGroup(): Promise<boolean>;
    stop(): Promise<boolean>;
    play(): Promise<boolean>;
    devicePropertiesService(): {
      GetHouseholdID(options?: Record<string, never>): Promise<Record<string, string>>;
    };
  }

  export class AsyncDeviceDiscovery {
    discoverMultiple(options?: { timeout?: number }): Promise<Sonos[]>;
  }
}
