// D3: Geocoin Carrier

import leaflet from "leaflet";
import "leaflet/dist/leaflet.css"; // style sheets
import "./style.css";
import "./leafletWorkaround.ts"; // Fix missing marker images
import luck from "./luck.ts"; // Deterministic random number generator

// app title
const APP_NAME = "Geocoin Carrier";
const app = document.querySelector<HTMLDivElement>("#app")!;
const header = document.createElement("h1");
header.innerHTML = APP_NAME;
app.append(header);

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;
const CACHE_RADIUS = 0.01; // defines how far caches can be spawned around player in lat/lng degrees

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// track player's coins inventory
let playerCoins = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = `You have ${playerCoins} coins.`;

// track geolocation state
let isGeolocationEnabled = false; // flag to track geolocation status
let geolocationWatchId: number | null = null; // store geolocation watch id
const geolocationButton = document.querySelector<HTMLButtonElement>("#sensor")!;

geolocationButton.addEventListener("click", () => {
  if (isGeolocationEnabled) {
    // stop geolocation tracking
    if (geolocationWatchId !== null) {
      navigator.geolocation.clearWatch(geolocationWatchId);
    }
    isGeolocationEnabled = false;
    geolocationButton.innerHTML = "🌐 Enable Geolocation"; // change button text
    console.log("Geolocation updates stopped");
  } else {
    // start geolocation tracking
    startGeolocationTracking();
    isGeolocationEnabled = true;
    geolocationButton.innerHTML = "🌐 Disable Geolocation"; // change button text
    console.log("Geolocation updates started");
  }
});

// helper func to convert latitude/longitude to global grid (i,j)
function _latLngToGrid(lat: number, lng: number): { i: number; j: number } {
  // global coordinates system setup
  const LATITUDE_TO_GRID = 1e6; // scaling factor
  const LONGITUDE_TO_GRID = 1e6; // scaling factor

  // convert lat/lng into global grid coordinates
  const i = Math.round(lat * LATITUDE_TO_GRID);
  const j = Math.round(lng * LONGITUDE_TO_GRID);

  return { i, j };
}

// flyweight pattern
interface Coin {
  i: number;
  j: number;
  serial: number;
}

class Cache {
  i: number;
  j: number;
  coins: Coin[];

  constructor(i: number, j: number) {
    this.i = i;
    this.j = j;
    this.coins = []; // Initialize the coins array
  }

  // serialize (save) cache state to a memento string
  toMemento(): string {
    return JSON.stringify({
      i: this.i,
      j: this.j,
      coins: this.coins, // Serialize coins array too
    });
  }

  // Deserialize (restore) cache state from a memento string
  fromMemento(memento: string): void {
    const state = JSON.parse(memento);
    this.i = state.i;
    this.j = state.j;
    this.coins = state.coins;
  }
}

// cache for storing grid coordinates w a cache for each unique location
const cacheGrid: { [key: string]: Cache } = {};

class CacheManager {
  private mementos: { [key: string]: string } = {}; // to store cache mementos by key

  // save cache's state to a memento
  saveCacheState(cache: Cache): void {
    const key = `${cache.i}:${cache.j}`;
    this.mementos[key] = cache.toMemento(); // save cache state as memento string
  }

  // restore cache's state from a memento
  restoreCacheState(cache: Cache): void {
    const key = `${cache.i}:${cache.j}`;
    const memento = this.mementos[key];

    if (memento) {
      cache.fromMemento(memento); // restore cache state from memento string
    }
  }
}

const cacheManager = new CacheManager();

class UIManager {
  // handles updating status panel
  private statusPanel: HTMLDivElement;

  constructor(statusPanelId: string) {
    const panel = document.querySelector<HTMLDivElement>(statusPanelId);
    if (!panel) throw new Error(`Cannot find status panel: ${statusPanelId}`);
    this.statusPanel = panel;
  }

  updateStatus(text: string): void {
    this.statusPanel.innerHTML = text;
  }
  // Adding/removing elements (like markers or rectangles) to/from the map

  // Managing popups (their behaviors and event listeners
}

const uiManager = new UIManager("#statusPanel");

class MapManager {
  private map: leaflet.Map;

  constructor(map: leaflet.Map) {
    this.map = map;
  }

  addCacheToMap(
    cache: Cache,
    bounds: leaflet.LatLngBounds,
    gridPosition: { i: number; j: number },
  ): void {
    // Create a rectangle on the map
    const rect = leaflet.rectangle(bounds);
    rect.addTo(this.map);

    // Attach a popup to the rectangle
    rect.bindPopup(() => {
      const globalI = gridPosition.i;
      const globalJ = gridPosition.j;

      // Create popup content
      const popupDiv = document.createElement("div");
      popupDiv.innerHTML = `
        <div>There is a cache here at "${globalI},${globalJ}". It has <span id="value">${cache.coins.length}</span> coins remaining.</div>
        <button id="collect">Collect Coin</button>
        <button id="deposit">Deposit Coin</button>
      `;

      // Add event listeners to interact with the cache
      this.addPopupEventListeners(popupDiv, cache);

      return popupDiv;
    });
  }

  private addPopupEventListeners(popupDiv: HTMLElement, cache: Cache): void {
    // Handle "Collect Coin" button
    popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
      "click",
      () => {
        if (cache.coins.length > 0) {
          cache.coins.pop(); // Remove a coin from the cache
          playerCoins++;
          statusPanel.innerHTML = `You have ${playerCoins} coins.`; // Update status panel

          // Update the cache state
          cacheManager.saveCacheState(cache);

          // Update the popup coin count
          const coinValue = popupDiv.querySelector<HTMLSpanElement>("#value");
          if (coinValue) {
            coinValue.textContent = cache.coins.length.toString();
          }
        } else {
          alert("This cache is out of coins!");
        }
      },
    );

    // Handle "Deposit Coin" button
    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
      "click",
      () => {
        if (playerCoins > 0) {
          cache.coins.push({
            i: cache.i,
            j: cache.j,
            serial: cache.coins.length,
          });
          playerCoins--;
          statusPanel.innerHTML = `You have ${playerCoins} coins.`; // Update status panel

          // Update the cache state
          cacheManager.saveCacheState(cache);

          // Update the popup coin count
          const coinValue = popupDiv.querySelector<HTMLSpanElement>("#value");
          if (coinValue) {
            coinValue.textContent = cache.coins.length.toString();
          }
        } else {
          alert("You have no coins to deposit!");
        }
      },
    );
  }
}

const mapManager = new MapManager(map);

class GameController {
  private uiManager: UIManager;
  private mapManager: MapManager;

  constructor(uiManager: UIManager, mapManager: MapManager) {
    this.uiManager = uiManager;
    this.mapManager = mapManager;
  }

  movePlayer(latChange: number, lngChange: number): void {
    // Move the player
    movePlayer(latChange, lngChange, this.uiManager);

    // Regenerate caches around the player's new position
    regenerateCaches(this.mapManager);

    // Update the UI status (you can customize this further)
    const currentPosition = playerMarker.getLatLng();
    this.uiManager.updateStatus(
      `Player moved to (${currentPosition.lat.toFixed(5)}, ${
        currentPosition.lng.toFixed(5)
      })`,
    );
  }
}

const gameController = new GameController(uiManager, mapManager);

function spawnCache(i: number, j: number, mapManager: MapManager) {
  const key = `${i}:${j}`;
  let cache = cacheGrid[key];

  if (!cache) {
    // Create a new cache
    cache = new Cache(i, j);
  }

  // Restore the cache state if it existed before
  cacheManager.restoreCacheState(cache);

  // Ensure new caches start with some coins
  if (cache.coins.length === 0) {
    const numCoins = Math.floor(luck([i, j, "coinCount"].toString()) * 5) + 1;
    for (let k = 0; k < numCoins; k++) {
      cache.coins.push({ i: cache.i, j: cache.j, serial: k });
    }
  }

  // Save the cache state
  cacheManager.saveCacheState(cache);

  // Delegate UI-related tasks to MapManager
  const bounds = leaflet.latLngBounds([
    [
      OAKES_CLASSROOM.lat + i * TILE_DEGREES,
      OAKES_CLASSROOM.lng + j * TILE_DEGREES,
    ],
    [
      OAKES_CLASSROOM.lat + (i + 1) * TILE_DEGREES,
      OAKES_CLASSROOM.lng + (j + 1) * TILE_DEGREES,
    ],
  ]);

  mapManager.addCacheToMap(cache, bounds, { i, j });
}

// Function to regenerate caches in the player's current neighborhood
function regenerateCaches(mapManager: MapManager): void {
  const currentPosition = playerMarker.getLatLng();

  // Clear distant caches
  clearDistantCaches(currentPosition);

  // Loop through the neighborhood size and add new caches
  for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
      if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j, mapManager);
      }
    }
  }
}

function clearDistantCaches(playerLatLng: leaflet.LatLng) {
  // Iterate through the cacheGrid and remove caches too far from the player
  Object.keys(cacheGrid).forEach((key) => {
    const cache = cacheGrid[key];
    const cacheLatLng = leaflet.latLng(
      OAKES_CLASSROOM.lat + cache.i * TILE_DEGREES,
      OAKES_CLASSROOM.lng + cache.j * TILE_DEGREES,
    );

    const distance = playerLatLng.distanceTo(cacheLatLng); // Get distance in meters
    if (distance > CACHE_RADIUS * 1000) { // Cache is too far, converted degrees to meters
      delete cacheGrid[key]; // Remove cache if it's too far
      console.log(`Removed cache at ${cacheLatLng.lat}, ${cacheLatLng.lng}`);
    }
  });
}

// movement step size in degrees
const MOVEMENT_STEP = 0.0001; // adjust this value as needed

// update player's position on map
function movePlayer(
  latChange: number,
  lngChange: number,
  uiManager: UIManager,
) {
  const currentLatLng = playerMarker.getLatLng();
  const newLat = currentLatLng.lat + latChange;
  const newLng = currentLatLng.lng + lngChange;

  const newLatLng = leaflet.latLng(newLat, newLng);
  playerMarker.setLatLng(newLatLng);

  // use UIManager to update status panel
  uiManager.updateStatus(
    `You are at (${newLat.toFixed(5)}, ${newLng.toFixed(5)})`,
  );

  // regenerate caches around new position
  regenerateCaches(mapManager);
}

// get references to buttons
const northButton = document.querySelector<HTMLButtonElement>("#north")!;
const southButton = document.querySelector<HTMLButtonElement>("#south")!;
const westButton = document.querySelector<HTMLButtonElement>("#west")!;
const eastButton = document.querySelector<HTMLButtonElement>("#east")!;

northButton.addEventListener(
  "click",
  () => gameController.movePlayer(MOVEMENT_STEP, 0),
); // Move north
southButton.addEventListener(
  "click",
  () => gameController.movePlayer(-MOVEMENT_STEP, 0),
); // Move south
westButton.addEventListener(
  "click",
  () => gameController.movePlayer(0, -MOVEMENT_STEP),
); // Move west
eastButton.addEventListener(
  "click",
  () => gameController.movePlayer(0, MOVEMENT_STEP),
); // Move east

// initial cache generation
regenerateCaches(mapManager);

// start geolocation tracking
function startGeolocationTracking() {
  // use geolocation api to watch device's position
  geolocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      updatePlayerPosition(latitude, longitude); // update player position on map
    },
    (error) => {
      console.error("Error getting geolocation:", error);
      alert("Unable to access geolocation.");
    },
    {
      enableHighAccuracy: true, // try to get most accurate location
      maximumAge: 1000, // get new location data at least every sec
      timeout: 5000, // timeout after 5 secs if no location is found
    },
  );
}

// update player position on map
function updatePlayerPosition(lat: number, lng: number) {
  // move player marker to new position based on geolocation
  const newLatLng = leaflet.latLng(lat, lng);
  playerMarker.setLatLng(newLatLng);
  map.setView(newLatLng); // center map to new pos

  // update status panel w new coordinates
  statusPanel.innerHTML = `You are at (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

  // regenerate caches around new pos
  regenerateCaches(mapManager);
}
