# Avengers Mahjong

An Avengers-themed Chinese mahjong room game for two human players and two NPCs.

## Run Locally

```bash
node server.js
```

Open `http://localhost:8787`.

## Deploy On Render

Create a Render **Web Service** from this repository.

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/`

The included `render.yaml` can also be used as a Render Blueprint.

After deployment, open the Render URL, click **Create Room**, and send the West player link to your friend.
