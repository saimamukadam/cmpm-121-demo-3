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
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!; // element `statusPanel` is defined in index.html
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

interface Cache {
  i: number;
  j: number;
  coins: Coin[];
}

// cache for storing grid coordinates w a cache for each unique location
const cacheGrid: { [key: string]: Cache } = {};

// func to get or create cache location (flyweight pattern)
//function getCache(i: number, j: number): Cache {
//  const key = `${i}:${j}`;
//  if (!cacheGrid[key]) {
// if cache doesnt exist then create one
//    cacheGrid[key] = { i, j, coins: [] }; // store coins as array
//  }
//  return cacheGrid[key];
//}

// func to spawn coin at given cache
//function spawnCoin(i: number, j: number, serial: number): void {
//  const cache = getCache(i, j);
//  const coin: Coin = { i, j, serial };
//  cache.coins.push(coin); // adding to cache coins array

//const coinId = `${i}:${j}#${serial}`;
//  console.log(`Coin Spawned: ${i}:${j}#${serial}`);
//}

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  // Convert local i,j coords to global i,j
  const origin = OAKES_CLASSROOM;
  const { i: globalI, j: globalJ } = latLngToGrid(
    origin.lat + i * TILE_DEGREES,
    origin.lng + j * TILE_DEGREES,
  );
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
    let pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);

    // The popup offers a description and button
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
                  <div>There is a cache here at "${globalI},${globalJ}". It has value <span id="value">${pointValue}</span>.</div>
                  <button id="collect">Collect Coin</button>
                  <button id="deposit">Deposit Coin</button>
      `;

    // Clicking the button decrements the cache's value and increments the player's coins
    // Handle the "Collect Coin" button (collecting a coin from the cache)
    popupDiv
      .querySelector<HTMLButtonElement>("#collect")!
      .addEventListener("click", () => {
        if (pointValue > 0) { // making sure cache has coins first
          pointValue--;
          playerCoins++;
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML =
            pointValue.toString();
          statusPanel.innerHTML = `${playerCoins} coins`;
        } else {
          alert("This cache is out of coins!");
        }
      });

    popupDiv
      .querySelector<HTMLButtonElement>("#deposit")!
      .addEventListener("click", () => {
        if (playerCoins > 0) {
          pointValue++;
          playerCoins--;
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML =
            pointValue.toString();
          statusPanel.innerHTML = `You have ${playerCoins} coins.`;
        } else {
          alert("You have no coins to deposit!");
        }
      });
    return popupDiv;
  });
}

// Look around the player's neighborhood for caches to spawn
//for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
//  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
// If location i,j is lucky enough, spawn a cache!
//    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
//      spawnCache(i, j);
//    }
//  }
//}

// display coins and caches
//const { i, j } = latLngToGrid(OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng);
//spawnCoin(i, j, 0);
//spawnCoin(i, j, 1);

//////////////////////////////CHANGES FOR CACHE REGEN//////////////////////////////////////////////////
// func to clear caches that r too far from player
function clearDistantCaches(playerLatLng: leaflet.LatLng) {
  //const playerLat = playerLatLng.lat;
  //const playerLng = playerLatLng.lng;

  // Iterate through the cacheGrid and remove caches too far from the player
  Object.keys(cacheGrid).forEach((key) => {
    const cache = cacheGrid[key];
    const cacheLatLng = leaflet.latLng(
      OAKES_CLASSROOM.lat + cache.i * TILE_DEGREES,
      OAKES_CLASSROOM.lng + cache.j * TILE_DEGREES,
    );

    const distance = playerLatLng.distanceTo(cacheLatLng); // Get distance in meters
    if (distance > CACHE_RADIUS) { // Cache is too far in degrees
      delete cacheGrid[key]; // Remove cache if it's too far
      console.log(`Removed cache at ${cacheLatLng.lat}, ${cacheLatLng.lng}`);
    }
  });
}

// Function to regenerate caches in the player's current neighborhood
function regenerateCaches() {
  const currentPosition = playerMarker.getLatLng();
  //const { lat, lng } = currentPosition;

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
//////////////////////////////////////////////////////////////////////////////////////////////////////

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
