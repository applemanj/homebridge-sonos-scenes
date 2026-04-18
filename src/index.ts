import type { API } from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME, SonosScenesPlatform } from "./platform";

export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SonosScenesPlatform);
};
