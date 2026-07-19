# /bridge Command

## Purpose
Start, stop, inspect, and secure the **GhostForge Mac Bridge** so the Vercel web UI can execute approved `ghostforge` commands on your Mac.

## Usage
```bash
/bridge
/bridge start
/bridge stop
/bridge status
/bridge token
```

## What it does
- Starts a local HTTP bridge on port `4747`
- Generates a random bearer token for Vercel → Mac authentication
- Optionally opens a Cloudflare tunnel if `cloudflared` is installed
- Restricts execution to plain `ghostforge ...` commands only
- Prints the `WS_BRIDGE_URL` and `WS_BRIDGE_TOKEN` values to copy into Vercel

## Local script
```bash
bash ~/ghostforge/scripts/bridge.sh start
bash ~/ghostforge/scripts/bridge.sh status
bash ~/ghostforge/scripts/bridge.sh token
bash ~/ghostforge/scripts/bridge.sh stop
```

## Required Vercel environment variables
- `WS_BRIDGE_URL`
- `WS_BRIDGE_TOKEN`

## Security notes
- The bridge rejects non-`ghostforge` commands
- Command chaining characters are blocked
- Authentication uses a bearer token stored under `~/.ghostforge/bridge/`
- Rotate the token by stopping the bridge and starting it again
