# Blockly3D live collaboration

Live rooms use a small self-hosted WebSocket relay. The relay keeps room state in memory and removes it after the last participant disconnects; it does not write project data to disk.

## Start locally

1. Install Node.js 20 or newer.
2. From this folder, run `npm install`.
3. Run `npm start`.
4. In Blockly3D, open **Live room** and leave the server URL as `ws://127.0.0.1:8787/collaboration`.
5. To collaborate with devices on the same local network, click **Generate** next to the server URL. Blockly3D replaces the loopback address with this computer's private network address.
6. Select **Host room**, then share the generated URL and displayed `000-000` room code with friends on the same network. Keep the relay running and allow it through the computer's firewall so other devices can connect.

To use another port, set `PORT` before starting the server. The server listens on all network interfaces by default. The `/health` URL reports whether it is running.

## Friends on another network

Run the relay on a machine your friends can reach, and put it behind a TLS-enabled reverse proxy. Use the resulting `wss://your-host/collaboration` URL in Blockly3D. Do not expose an unencrypted `ws://` relay to the public internet. Room codes are temporary access tokens: anyone who has one can view and edit that room, so share codes privately.

The server allows at most 16 participants per room and 30 MB per project snapshot. Changes are shared as whole-project snapshots; when simultaneous edits conflict, the most recently received snapshot wins. Block dragging, adding, and deleting also show the collaborator's name in a consistent color. Saving a `.b3d` file remains available for a portable local backup.
