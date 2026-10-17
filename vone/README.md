# Luxcores Godot Client

The Godot client renders match maps and server snapshots. Match simulation, command validation, and updates run on the backend through its plain WebSocket API.

## Run

Open `vone/project.godot` in Godot 4.6 and run the project. The window defaults to 600 × 800. Set its width and height on the connection screen, then select Apply Size. Godot scales the interface uniformly as the window changes size and keeps its portrait proportions. Start the backend from `backend/nodejs/`, then enter its HTTP address on the connection screen. Use `http://127.0.0.1:3000` when both processes run on one computer. A phone must use the computer's LAN address.

Choose a player name, leave Match ID blank to host, and enable Play against bot for a solo match. Share the displayed match ID for another player to join. The host starts the match from the in-game controls.

The first guest sign-in stores a device secret in Godot's user data. Later launches reuse that secret through the backend's device sign-in route.

## Current Playable Slice

The client displays the procedural map, lane paths, vents, cores, blockers, buildings and server snapshots. It supports host and join flows, guest authentication, starting matches, placing economy buildings and towers, and requesting building recycling. The server decides whether each command succeeds.

Hero movement, creep orders, combat controls, rendering polish, and mobile touch gestures remain future work. The root HTML client and simulation remain the reference for gameplay rules.
