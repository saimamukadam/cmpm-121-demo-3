// D3: Geocoin Carrier

import leaflet from "leaflet";
import "leaflet/dist/leaflet.css"; // style sheets
import "./style.css";
import "./leafletWorkaround.ts"; // Fix missing marker images
import luck from "./luck.ts"; // Deterministic random number generator
import { latLng as _latLng } from "npm:@types/leaflet@^1.9.14";

// app title
const APP_NAME = "Geocoin Carrier";
const app = document.querySelector<HTMLDivElement>("#app")!;
const header = document.createElement("h1");
header.innerHTML = APP_NAME;
app.append(header);

// load saved game state from local storage on page load
globalThis.addEventListener("load", () => {
  loadGameState();
});

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

// track player's movement history w array
let moveHistory: leaflet.LatLng[] = [];

// create a polyline to rep the movement history
const movePolyline = leaflet.polyline([], {
  color: "blue",
  weight: 4,
  opacity: 0.7,
  dashArray: "5, 10",
}).addTo(map);

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
    // save all mementos to localStorage for persistence
    localStorage.setItem("cacheStates", JSON.stringify(this.mementos));
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

// Function to calculate the bounds of a cache based on its grid position
function getBoundsFromCache(cache: Cache) {
  const northWestLat = cache.i * TILE_DEGREES;
  const northWestLng = cache.j * TILE_DEGREES;
  const southEastLat = (cache.i + 1) * TILE_DEGREES;
  const southEastLng = (cache.j + 1) * TILE_DEGREES;

  return [
    [northWestLat, northWestLng], // Northwest corner
    [southEastLat, southEastLng], // Southeast corner
  ];
}

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
        <div>Coins in this cache:</div>
        <ul>
          ${
        cache.coins.map((coin, index) => `
            <li><span class="coin" data-serial="${coin.serial}">Coin ${
          index + 1
        }</span></li>
          `).join("")
      }
        </ul>
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

          // save game state
          saveGameState();

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

    // allow clicking on coin identifier to center map on cache's home
    popupDiv.querySelectorAll<HTMLSpanElement>(".coin").forEach(
      (coinElement) => {
        coinElement.addEventListener("click", () => {
          // center map on this cache
          const cacheLatLng = leaflet.latLng(
            OAKES_CLASSROOM.lat + cache.i * TILE_DEGREES,
            OAKES_CLASSROOM.lng + cache.j * TILE_DEGREES,
          );
          map.setView(cacheLatLng, GAMEPLAY_ZOOM_LEVEL);
          console.log(
            `Centering map on cache at ${cacheLatLng.lat}, ${cacheLatLng.lng}`,
          );
        });
      },
    );
  }
}

const mapManager = new MapManager(map);

class GameController {
  public uiManager: UIManager;
  public mapManager: MapManager;

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

// update movement history and polyline everytime player moves
function updateMovementHistory(newPosition: leaflet.latLng) {
  // add new pos to movement hist.
  moveHistory.push(newPosition);

  // update polyline w new movement hist.
  movePolyline.setLatLngs(moveHistory);
}

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

  // update movement hist. and polyline
  updateMovementHistory(newLatLng);

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
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!;

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
resetButton.addEventListener("click", () => {
  const confirmation = prompt(
    "Are you sure you want to reset the game? This will erase all coins and reset your location history. Type 'yes' to confirm.",
  );
  if (confirmation && confirmation.toLowerCase() === "yes") {
    resetGame();
  }
});

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

// storing + loading game state & handling geolocation

// save player's game state to local storage
function saveGameState() {
  const currentPosition = playerMarker.getLatLng();
  const gameState = {
    playerLat: currentPosition.lat,
    playerLng: currentPosition.lng,
    playerCoins: playerCoins,
    isGeolocationEnabled: isGeolocationEnabled,
  };

  // save game state as a string in local storage
  localStorage.setItem("gameState", JSON.stringify(gameState));

  // save cache states
  const cacheStates = Object.values(cacheGrid).map((cache: Cache) =>
    cache.toMemento()
  );
  localStorage.setItem("cacheStates", JSON.stringify(cacheStates));
  console.log("Game state saved!");
}

function loadGameState() {
  const savedState = localStorage.getItem("gameState");
  if (savedState) {
    const gameState = JSON.parse(savedState);
    playerCoins = gameState.playerCoins || 0;
    const restoredLatLng = leaflet.latLng(
      gameState.playerLat,
      gameState.playerLng,
    );
    playerMarker.setLatLng(restoredLatLng); // move player to saved position

    statusPanel.innerHTML = `You have ${playerCoins} player coins.`;

    // restore geolocation state
    if (gameState.isGeolocationEnabled) {
      startGeolocationTracking(); // resume geolocation if it was enabled
    }

    console.log("Game state loaded!");
  } else {
    console.log("No saved game state found.");
  }

  // restore cache states
  const savedCacheStates = localStorage.getItem("cacheStates");
  if (savedCacheStates) {
    const cacheStates = JSON.parse(savedCacheStates);
    cacheStates.forEach((memento: string) => {
      const cache = new Cache(0, 0); // init cache w dummy data
      cache.fromMemento(memento); // restore cache from memento string

      const cacheBounds = getBoundsFromCache(cache);
      //cacheGrid[`${cache.i}:${cache.j}`] = cache; // add to cache grid

      // regenerate caches in the UI
      mapManager.addCacheToMap(cache, cacheBounds, { i: cache.i, j: cache.j });
    });
    console.log("Cache states loaded!");
  }
}

// saving game periodically
gameController.movePlayer = function (
  latChange: number,
  lngChange: number,
): void {
  movePlayer(latChange, lngChange, this.uiManager);
  regenerateCaches(this.mapManager);

  // save game state after ever move
  saveGameState();

  const currentPosition = playerMarker.getLatLng();
  this.uiManager.updateStatus(
    `Player moved to (${currentPosition.lat.toFixed(5)}, ${
      currentPosition.lng.toFixed(5)
    })`,
  );
};

function resetGame() {
  // reset player's coins
  playerCoins = 0;
  statusPanel.innerHTML = `You have ${playerCoins} coins.`;

  // reset player's position
  playerMarker.setLatLng(OAKES_CLASSROOM);
  map.setView(OAKES_CLASSROOM, GAMEPLAY_ZOOM_LEVEL);

  // clear cache grid + reset cache markers
  for (const key in cacheGrid) {
    delete cacheGrid[key];
  }

  // clear all saved data from local storage
  localStorage.removeItem("gameState");
  localStorage.removeItem("cacheStates");

  // clear polyline
  moveHistory = []; // clear history
  movePolyline.setLatLngs(moveHistory); // update polyline w empty array

  // regenerate caches after reset (they will be reloaded from the mementos)
  regenerateCaches(mapManager);

  console.log("Game reset!");
}
