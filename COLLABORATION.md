# Blockly3D live collaboration

Live rooms use a small self-hosted WebSocket relay. The relay keeps room state in memory and removes it after the last participant disconnects; it does not write project data to disk.

## Start locally

1. Install Node.js 20 or newer.
2. From this folder, run `npm install`.
3. Run `npm start`.
4. In Blockly3D, open **Live room** and use `ws://127.0.0.1:8787/collaboration` for the local server.
5. To collaborate on the same local network, enter the host computer's private network address in the URL (for example, `ws://192.168.1.20:8787/collaboration`). Keep the relay running and allow it through the computer's firewall.
6. Select **Host room**, then share that URL and the displayed `000-000` room code with friends on the same network.

To use another port, set `PORT` before starting the server. The server listens on all network interfaces by default. The `/health` URL reports whether it is running.

## Friends on another network

Run the relay on a machine your friends can reach, and put it behind a TLS-enabled reverse proxy. Enter the resulting `wss://your-host/collaboration` URL in Blockly3D; the client supports secure WebSocket connections directly. Do not expose an unencrypted `ws://` relay to the public internet. Room codes are temporary access tokens: anyone who has one can view and edit that room, so share codes privately.

The server allows at most 16 participants per room and 30 MB per project snapshot. Changes are shared as whole-project snapshots; when simultaneous edits conflict, the most recently received snapshot wins. Block dragging, adding, and deleting also show the collaborator's name in a consistent color. Saving a `.b3d` file remains available for a portable local backup.
