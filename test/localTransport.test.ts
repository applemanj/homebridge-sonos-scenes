import assert from "node:assert/strict";
import test from "node:test";
import { buildFavoriteTransportUri, parseFavoriteBrowseXml } from "../src/transports/localTransport";

const rawFavoriteBrowseXml = `
  <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
    <item id="FV:2/11" parentID="FV:2" restricted="false">
      <dc:title>Audio Component: Upper Level</dc:title>
      <upnp:class>object.itemobject.item.sonos-favorite</upnp:class>
      <res protocolInfo="x-rincon-stream:*:*:*">x-rincon-stream:RINCON_347E5C07C5F901400</res>
      <r:type>instantPlay</r:type>
      <r:description>Line-In</r:description>
      <r:resMD>&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns:r=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;RINCON_347E5C07C5F901400&quot; parentID=&quot;&quot; restricted=&quot;true&quot;&gt;&lt;dc:title&gt;Audio Component: Upper Level&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.audioItem.linein&lt;/upnp:class&gt;&lt;desc id=&quot;cdudn&quot; nameSpace=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot;&gt;&lt;/desc&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>
    </item>
    <item id="FV:2/9" parentID="FV:2" restricted="false">
      <dc:title>The Hipster Orchestra</dc:title>
      <upnp:class>object.itemobject.item.sonos-favorite</upnp:class>
      <res></res>
      <r:type>shortcut</r:type>
      <r:description>Artist</r:description>
      <r:resMD>&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns:r=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;10052064artist%3a1314005644&quot; parentID=&quot;10052064artist%3a1314005644&quot; restricted=&quot;true&quot;&gt;&lt;dc:title&gt;The Hipster Orchestra&lt;/dc:title&gt;&lt;upnp:class&gt;object.container.person.musicArtist&lt;/upnp:class&gt;&lt;desc id=&quot;cdudn&quot; nameSpace=&quot;urn:schemas-rinconnetworks-com:metadata-1-0/&quot;&gt;SA_RINCON52231_X_#Svc52231-0-Token&lt;/desc&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</r:resMD>
    </item>
  </DIDL-Lite>
`;

test("parseFavoriteBrowseXml preserves direct favorite URIs and metadata", () => {
  const favorites = parseFavoriteBrowseXml(rawFavoriteBrowseXml);
  const directFavorite = favorites.find((favorite) => favorite.id === "2/11");

  assert.ok(directFavorite);
  assert.equal(directFavorite.name, "Audio Component: Upper Level");
  assert.equal(directFavorite.description, "Line-In");
  assert.equal(directFavorite.playbackType, "instantPlay");
  assert.equal(directFavorite.uri, "x-rincon-stream:RINCON_347E5C07C5F901400");
  assert.equal(directFavorite.transportUri, "x-rincon-stream:RINCON_347E5C07C5F901400");
  assert.match(directFavorite.metadata ?? "", /Audio Component: Upper Level/);
});

test("buildFavoriteTransportUri derives container URIs for shortcut favorites", () => {
  const favorites = parseFavoriteBrowseXml(rawFavoriteBrowseXml);
  const shortcutFavorite = favorites.find((favorite) => favorite.id === "2/9");

  assert.ok(shortcutFavorite);
  assert.equal(shortcutFavorite.name, "The Hipster Orchestra");
  assert.equal(shortcutFavorite.description, "Artist");
  assert.equal(shortcutFavorite.playbackType, "shortcut");
  assert.equal(shortcutFavorite.uri, undefined);
  assert.equal(shortcutFavorite.playable, false);
  assert.match(shortcutFavorite.unsupportedReason ?? "", /not playable through the local transport/i);
  assert.equal(
    buildFavoriteTransportUri(shortcutFavorite),
    "x-rincon-cpcontainer:10052064artist%3a1314005644",
  );
  assert.equal(shortcutFavorite.transportUri, "x-rincon-cpcontainer:10052064artist%3a1314005644");
  assert.match(shortcutFavorite.metadata ?? "", /object\.container\.person\.musicArtist/);
});
