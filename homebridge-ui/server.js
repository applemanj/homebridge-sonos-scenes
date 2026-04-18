const { HomebridgePluginUiServer, RequestError } = require("@homebridge/plugin-ui-utils");

function loadServerApi() {
  try {
    return require("../dist/src/ui/serverApi.js");
  } catch (error) {
    throw new RequestError("The plugin UI server requires a built dist/ folder. Run npm run build first.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.serverApi = loadServerApi();
    this.onRequest("/defaults", this.handleDefaults.bind(this));
    this.onRequest("/discover", this.handleDiscover.bind(this));
    this.onRequest("/validate-scene", this.handleValidateScene.bind(this));
    this.onRequest("/run-test", this.handleRunTest.bind(this));

    this.ready();
  }

  async handleDefaults() {
    return this.serverApi.createDefaultUiConfig();
  }

  async handleDiscover(payload = {}) {
    try {
      return await this.serverApi.discoverForUi(payload.config);
    } catch (error) {
      throw this.asRequestError(error, "Discovery failed");
    }
  }

  async handleValidateScene(payload = {}) {
    try {
      return await this.serverApi.validateSceneForUi(payload.config, payload.scene ?? {});
    } catch (error) {
      throw this.asRequestError(error, "Validation failed");
    }
  }

  async handleRunTest(payload = {}) {
    try {
      const result = await this.serverApi.runTestForUi(payload.config, payload.scene ?? {});
      this.pushEvent("scene-test-result", result);
      return result;
    } catch (error) {
      throw this.asRequestError(error, "Scene test failed");
    }
  }

  asRequestError(error, fallbackMessage) {
    if (error instanceof RequestError) {
      return error;
    }

    return new RequestError(error instanceof Error ? error.message : fallbackMessage, {
      cause: error instanceof Error ? error.stack : String(error),
    });
  }
}

(() => new UiServer())();
