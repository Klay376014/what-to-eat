import { describe, expect, test } from "vite-plus/test";
import { parsePlaceUrl, redirectLocation, redirectRequest, shortLink } from "./mapsLink.ts";

/*
 * Redirect targets captured from real maps.app.goo.gl links (September 2026),
 * requested with no User-Agent and no redirect following, exactly as the
 * maps-link Edge Function asks. Each comment names the short link.
 */

// maps.app.goo.gl/2nWdWPR2gTpXpxqx6: a .com place whose data carries a
// building's feature id (!5s) before the place's own (!1s).
const JACK_BASKIN =
  "https://www.google.com/maps/place/Jack+Baskin+Engineering/@37.0003791,-122.0657715,17z/data=!3m2!4b1!5s0x808e417502d57005:0x8580897e73d60a70!4m6!3m5!1s0x808e4174e0eafc51:0x13397e072d0f2a67!8m2!3d37.0003748!4d-122.0631966!16zL20vMGJwMG1k?entry=tts&g_ep=EgoyMDI0MDcyOS4xKgBIAVAD";

// maps.app.goo.gl/2avW6UjkkDbgHUwPA: a restaurant in Taipei, sent to
// google.com.tw, with its name in Chinese.
const NTUST_CAFETERIA =
  "https://www.google.com.tw/maps/place/%E7%BE%8E%E5%BE%B7%E8%80%90+%E5%8F%B0%E7%A7%91%E5%A4%A7%E6%B4%BB%E5%8B%95%E4%B8%AD%E5%BF%83%E7%AC%AC%E4%B8%80%E9%A4%90%E5%BB%B3/@25.0149717,121.5347183,16z/data=!3m1!5s0x3442aa23df550f61:0xbd1f0f49806d5351!4m7!3m6!1s0x3442aa2161bff4eb:0x9c6faff365e98178!8m2!3d25.0140156!4d121.542539!15sCidOVFVTVCBGaXJzdCBTdHVkZW50IENhZmV0ZXJpYSDnvo7lvrfogJBaKiIobnR1c3QgZmlyc3Qgc3R1ZGVudCBjYWZldGVyaWEg576O5b63IOiAkJIBCmZvb2RfY291cnTgAQA!16s%2Fg%2F11c40qvpfr?entry=tts&g_ep=EgoyMDI1MDQwMi4xIPu8ASoASAFQAw%3D%3D&skid=522982f3-7797-48a7-9eb4-207582235e93";

// maps.app.goo.gl/4v7ve3CECXzbods89: zoomed out over Delhi, so the map's
// centre (@) is kilometres from the place (!3d/!4d).
const NEW_DELHI =
  "https://www.google.com/maps/place/New+Delhi,+Delhi/@28.5487416,77.0901924,11z/data=!4m6!3m5!1s0x390cfd5b347eb62d:0x52c2b7494e204dce!8m2!3d28.6139298!4d77.2088282!16zL20vMGRsdjA?entry=tts&g_ep=EgoyMDI2MDUyMC4wIPu8ASoASAFQAw%3D%3D&skid=426e0325-a80c-4929-9a63-0c8c173ffc71";

// maps.app.goo.gl/3hWxRhEpYAC6wH3i9: a name with an encoded "/" in it.
const ALBERTOV =
  "https://www.google.com/maps/place/Albertov+2038%2F6,+128+00+Nov%C3%A9+M%C4%9Bsto/@50.0686804,14.422048,17z/data=!3m1!4b1!4m6!3m5!1s0x470b9461c9f72959:0xf44a44e95bc8e22f!8m2!3d50.068677!4d14.4246229!16s%2Fg%2F11bw42386c?entry=tts";

// maps.app.goo.gl/27Jewne9cvYxC4SW8: a search for coordinates, not a place.
const SEARCH =
  "https://www.google.com/maps/search/-29.055508,+26.153821?entry=tts&g_ep=EgoyMDI2MDUyNy4wIPu8ASoASAFQAw%3D%3D&skid=18f401c2-1f1f-414e-8410-f0e85e1438a0";

// maps.app.goo.gl/419kpUXiYFoLYZTK7: directions, with a feature id and
// coordinates of its own, but no place.
const DIRECTIONS =
  "https://www.google.com/maps/dir//Inria+de+l'Universit%C3%A9+de+Rennes,+Avenue+G%C3%A9n%C3%A9ral+Leclerc,+Rennes/@48.1162515,-1.6420225,17z/data=!4m8!4m7!1m0!1m5!1m1!1s0x480edee5a599f107:0x318da7854b094389!2m2!1d-1.6396323!2d48.1162039?hl=en-US&entry=tts";

// maps.app.goo.gl/3H4T2CQN8PfLSBbt6: a place with a feature id but no
// !3d/!4d coordinates.
const NO_COORDINATES =
  "https://www.google.com/maps/place/Rev.+E.J.+Motau+st,+Kudube+Unit+2,+Temba/data=!4m2!3m1!1s0x1ebfc06ee282e2a9:0x843802deff256922!18m1!1e1?utm_source=mstt_1&entry=gps&coh=192189&skid=c92b8abb-394a-46bd-861c-4234ad4fa0ec";

// maps.app.goo.gl/4vJWCSgdhM8zmudN7: a dropped pin on google.hu, with
// coordinates but no feature id.
const DROPPED_PIN =
  "https://www.google.hu/maps/place/43%C2%B045'36.6%22N+19%C2%B017'20.4%22E/@43.7599245,19.283682,1642m/data=!3m1!1e3!4m4!3m3!8m2!3d43.7601714!4d19.2889867?coh=245187&entry=tts&g_ep=EgoyMDI1MDUwMy4wIPu8ASoJLDEwMjExNDUzSAFQAw%3D%3D&skid=b69334ca-4703-474c-b590-9598a4b534ad";

describe("parsePlaceUrl", () => {
  test("a place link yields its name, coordinates and CID", () => {
    expect(parsePlaceUrl(JACK_BASKIN)).toEqual({
      placeName: "Jack Baskin Engineering",
      lat: 37.0003748,
      lng: -122.0631966,
      placeCid: "1385276929678977639",
    });
  });

  test("a place on a country's own host (google.com.tw) is read the same, name decoded", () => {
    expect(parsePlaceUrl(NTUST_CAFETERIA)).toEqual({
      placeName: "美德耐 台科大活動中心第一餐廳",
      lat: 25.0140156,
      lng: 121.542539,
      placeCid: "11272421852253356408",
    });
  });

  test("the coordinates are the place's (!3d/!4d), not the map's centre (@)", () => {
    const place = parsePlaceUrl(NEW_DELHI);
    expect(place).toMatchObject({ lat: 28.6139298, lng: 77.2088282 });
    expect(place?.lat).not.toBe(28.5487416);
    expect(place?.lng).not.toBe(77.0901924);
  });

  test("the CID is the place's own feature id (!1s), not the building's (!5s)", () => {
    expect(parsePlaceUrl(NTUST_CAFETERIA)?.placeCid).toBe("11272421852253356408");
    expect(parsePlaceUrl(JACK_BASKIN)?.placeCid).toBe("1385276929678977639");
  });

  test("an encoded slash stays part of the name", () => {
    expect(parsePlaceUrl(ALBERTOV)?.placeName).toBe("Albertov 2038/6, 128 00 Nové Město");
  });

  test("a link that is not to a place could not be parsed", () => {
    expect(parsePlaceUrl(SEARCH)).toBeNull();
    expect(parsePlaceUrl(DIRECTIONS)).toBeNull();
  });

  test("a place with no coordinates could not be parsed", () => {
    expect(parsePlaceUrl(NO_COORDINATES)).toBeNull();
  });

  test("a place with no feature id could not be parsed", () => {
    expect(parsePlaceUrl(DROPPED_PIN)).toBeNull();
  });

  test("malformed input could not be parsed, and nothing throws", () => {
    for (const input of [
      "",
      "not a link",
      "https://",
      "https://www.google.com/maps/place/",
      "https://www.google.com/maps/place/+++/data=!1s0x1:0x2!3d1!4d2",
      "https://www.google.com/maps/place/%E0%A4%A/data=!1s0x1:0x2!3d1!4d2",
      "https://www.google.com/maps/place/Afuri/data=!1s0x1:0x2!3d91!4d2",
      "https://www.google.com/maps/place/Afuri/data=!1s0x1:0x2!3dabc!4d2",
      "https://www.google.com/maps/place/Afuri/data=!1s0x1:0x0!3d1!4d2",
      "https://www.google.com/maps/place/Afuri/data=!1s0x1:0x12345678901234567!3d1!4d2",
    ]) {
      expect(parsePlaceUrl(input), input).toBeNull();
    }
  });

  test("the markers are read only from the address's path, not its query", () => {
    expect(
      parsePlaceUrl("https://www.google.com/maps/place/Afuri/?q=!1s0x1:0x2!3d1!4d2"),
    ).toBeNull();
  });
});

describe("shortLink", () => {
  test("a Maps short link, as the share sheet gives it, is one", () => {
    expect(shortLink("https://maps.app.goo.gl/2nWdWPR2gTpXpxqx6")?.href).toBe(
      "https://maps.app.goo.gl/2nWdWPR2gTpXpxqx6",
    );
    expect(shortLink(" https://maps.app.goo.gl/2nWdWPR2gTpXpxqx6?g_st=ic ")?.href).toBe(
      "https://maps.app.goo.gl/2nWdWPR2gTpXpxqx6?g_st=ic",
    );
  });

  test("anything else is not asked about", () => {
    for (const input of [
      "",
      "Ichiran Shibuya",
      "http://maps.app.goo.gl/2nWdWPR2gTpXpxqx6",
      "https://maps.app.goo.gl/",
      "https://maps.app.goo.gl/a/b",
      "https://maps.app.goo.gl.evil.example/2nWdWPR2gTpXpxqx6",
      "https://user@maps.app.goo.gl/2nWdWPR2gTpXpxqx6",
      "https://maps.app.goo.gl:8443/2nWdWPR2gTpXpxqx6",
      "https://maps.app.goo.gl/2nWd%0D%0AX",
      "https://www.google.com/maps/place/Jack+Baskin+Engineering",
      "https://goo.gl/maps/2nWdWPR2gTpXpxqx6",
    ]) {
      expect(shortLink(input), input).toBeNull();
    }
  });
});

describe("redirectRequest", () => {
  test("asks for the link's path with no User-Agent, and nothing to follow", () => {
    const request = redirectRequest(
      shortLink("https://maps.app.goo.gl/2nWdWPR2gTpXpxqx6?g_st=ic")!,
    );
    expect(request).toBe(
      "GET /2nWdWPR2gTpXpxqx6?g_st=ic HTTP/1.1\r\nHost: maps.app.goo.gl\r\nConnection: close\r\n\r\n",
    );
    expect(request.toLowerCase()).not.toContain("user-agent");
  });
});

describe("redirectLocation", () => {
  // The head of a real reply to a request with no User-Agent (trimmed).
  const FOUND = [
    "HTTP/1.1 302 Found",
    "Content-Type: text/html; charset=utf-8",
    `Location: ${JACK_BASKIN}&g_st=ic`,
    "Server: ESF",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  test("a redirect gives where it points", () => {
    expect(redirectLocation(FOUND)).toBe(`${JACK_BASKIN}&g_st=ic`);
  });

  test("the header name is read in any case", () => {
    expect(redirectLocation("HTTP/1.1 301 Moved\r\nlocation: https://example.com/x\r\n\r\n")).toBe(
      "https://example.com/x",
    );
  });

  test("anything but a redirect with somewhere to go gives nothing", () => {
    for (const head of [
      // What a browser User-Agent is served: a page, no Location.
      "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n",
      "HTTP/1.1 200 OK\r\nLocation: https://example.com/x\r\n\r\n",
      "HTTP/1.1 404 Not Found\r\n\r\n",
      "HTTP/1.1 302 Found\r\nContent-Length: 0\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: \r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: /relative\r\n\r\n",
      "",
      "garbage",
    ]) {
      expect(redirectLocation(head), head).toBeNull();
    }
  });
});
