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

// helper func to convert latitude/longitude to global grid (i,j)
function latLngToGrid(lat: number, lng: number): { i: number; j: number } {
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

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  // Convert local i,j coords to global i,j
  const origin = OAKES_CLASSROOM;
  const { i: globalI, j: globalJ } = latLngToGrid(
    origin.lat + i * TILE_DEGREES,
    origin.lng + j * TILE_DEGREES,
  );

  // check if this cache has been seen before (if it's in the memento)
  const key = `${i}:${j}`;
  let cache = cacheGrid[key];

  // if this cache does not exist in the cacheGrid, create a new one
  if (!cache) {
    cache = new Cache(i, j); // new cache, not yet saved or restored
  }

  // restore each cache state if it was saved earlier
  cacheManager.restoreCacheState(cache);

  // Ensure each new cache starts with a random number of coins (you can adjust this as needed)
  if (cache.coins.length === 0) {
    const numCoins = Math.floor(luck([i, j, "coinCount"].toString()) * 5) + 1; // Random number of coins (1-5)
    for (let k = 0; k < numCoins; k++) {
      cache.coins.push({ i: cache.i, j: cache.j, serial: k });
    }
  }

  // add rectangle to map to rep cache
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Handle interactions with the cache
  rect.bindPopup(() => {
    // Each cache has a random point value, mutable by the player
    // The popup offers a description and button
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>There is a cache here at "${globalI},${globalJ}". It has <span id="value">${cache.coins.length}</span> coins remaining.</div>
      <button id="collect">Collect Coin</button>
      <button id="deposit">Deposit Coin</button>
      `;

    // Clicking the button decrements the cache's value and increments the player's coins
    // Handle the "Collect Coin" button (collecting a coin from the cache)
    popupDiv
      .querySelector<HTMLButtonElement>("#collect")!
      .addEventListener("click", () => {
        if (cache.coins.length > 0) { // making sure cache has coins first
          // remove a coin from the cache
          cache.coins.pop();
          playerCoins++;
          statusPanel.innerHTML = `You have ${playerCoins} coins.`;

          // Update the displayed coin count in the popup
          const coinValue = popupDiv.querySelector<HTMLSpanElement>("#value");
          if (coinValue) {
            coinValue.textContent = cache.coins.length.toString(); // Update the coin count displayed in the popup
          }

          // after coin collection, update the cache's memento state
          cacheManager.saveCacheState(cache);
          console.log(
            `Cache state updated. Coins remaining: ${cache.coins.length}`,
          );
        } else {
          alert("This cache is out of coins!");
        }
      });

    popupDiv
      .querySelector<HTMLButtonElement>("#deposit")!
      .addEventListener("click", () => {
        if (playerCoins > 0) {
          // Add a coin to the cache
          cache.coins.push({
            i: cache.i,
            j: cache.j,
            serial: cache.coins.length,
          });

          // Update the displayed coin count in the popup
          const coinValue = popupDiv.querySelector<HTMLSpanElement>("#value");
          if (coinValue) {
            coinValue.textContent = cache.coins.length.toString(); // Update the coin count in the popup
          }

          // Update the memento state
          cacheManager.saveCacheState(cache);
          playerCoins--;
          statusPanel.innerHTML = `You have ${playerCoins} coins.`;
          console.log(
            `Cache state updated. Coins added. New total: ${cache.coins.length}`,
          );
        } else {
          alert("You have no coins to deposit!");
        }
      });
    return popupDiv;
  });

  // save the cache state after creation or update
  cacheManager.saveCacheState(cache);
}

// Function to regenerate caches in the player's current neighborhood
function regenerateCaches() {
  const currentPosition = playerMarker.getLatLng();

  // Clear distant caches
  clearDistantCaches(currentPosition);

  // Loop through the neighborhood size and add new caches
  for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
      if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
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
function movePlayer(latChange: number, lngChange: number) {
  const currentLatLng = playerMarker.getLatLng();
  const newLat = currentLatLng.lat + latChange;
  const newLng = currentLatLng.lng + lngChange;

  const newLatLng = leaflet.latLng(newLat, newLng);
  playerMarker.setLatLng(newLatLng);

  // update status panel
  statusPanel.innerHTML = `You are at (${newLat.toFixed(5)}, ${
    newLng.toFixed(5)
  })`;

  // regenerate caches around new position
  regenerateCaches();
}

// get references to buttons
const northButton = document.querySelector<HTMLButtonElement>("#north")!;
const southButton = document.querySelector<HTMLButtonElement>("#south")!;
const westButton = document.querySelector<HTMLButtonElement>("#west")!;
const eastButton = document.querySelector<HTMLButtonElement>("#east")!;

// add event listeners to each button
northButton.addEventListener("click", () => movePlayer(MOVEMENT_STEP, 0)); // Move north
southButton.addEventListener("click", () => movePlayer(-MOVEMENT_STEP, 0)); // Move south
westButton.addEventListener("click", () => movePlayer(0, -MOVEMENT_STEP)); // Move west
eastButton.addEventListener("click", () => movePlayer(0, MOVEMENT_STEP)); // Move east

// initial cache generation
regenerateCaches();
