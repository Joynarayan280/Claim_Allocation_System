
# Deployment Guide

## 1. What You Need

| Item | Recommendation |
|---|---|
| Database | MongoDB Atlas **M10 or larger**, region **Mumbai (ap-south-1)**. The free M0 tier (512 MB, shared) is not suitable for production volumes. Turn on **Cloud Backup**. |
| App server | One VPS: AWS Lightsail / EC2 (Mumbai) or DigitalOcean (Bangalore), 2 vCPU / 4 GB RAM to start, Ubuntu 22.04+. |
| Runtime | Node.js 20 or newer, PM2, Nginx. |
| Domain + HTTPS | Any registrar (GoDaddy, BigRock, Namecheap, Cloudflare). Free certificate from Let's Encrypt. **HTTPS is mandatory**: in production the login cookie is marked `Secure`. |

## 2. First-Time Setup

```bash
# On the server
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

sudo npm i -g pm2

# Upload the project (without node_modules and without .env), then:
cd /var/www/insurance_claim

npm install --omit=dev

cp .env.example .env && nano .env
# Fill in every value (see comments in the file)

npm test
# Optional: runs the unit tests

pm2 start server.js --name claimdispatch

pm2 save && pm2 startup
# Restart automatically after a reboot
```

Check `http://SERVER-IP:5000/health` returns:

```json
{"ok":true,"db":true}
```

> **Run exactly one instance** (`pm2 start ...` without `-i`). Real-time updates use socket.io, which needs a Redis adapter before it can run on several processes at once. One Node process comfortably serves hundreds of simultaneous users; the heavy lifting is done by MongoDB.

## 3. Nginx Configuration

File: `/etc/nginx/sites-available/caseallocation`

```nginx
server {
    server_name claims.yourcompany.com;
    client_max_body_size 10m;
    gzip on;
    gzip_types text/css application/javascript application/json;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        # WebSockets (socket.io)

        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Enable Nginx and configure HTTPS:

```bash
sudo ln -s /etc/nginx/sites-available/claimdispatch /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d claims.yourcompany.com

sudo certbot renew --dry-run
# Confirms automatic renewal works
```

## 4. Domain Configuration

In the registrar's DNS panel, create an **A record**:

- Host: `claims`
- Value: The server's public IP address.

It is usually live within 5 to 30 minutes.

In Atlas → Network Access, allow only the server's IP address (never `0.0.0.0/0` in production).

## 5. Updating the Application

```bash
cd /var/www/insurance_claim

# Upload the new files, then:
npm install --omit=dev

pm2 restart claimdispatch

pm2 logs claimdispatch --lines 100
```

On every start, the server repairs/creates its database indexes automatically (`utils/ensureIndexes.js`); problems are printed to the log but never stop the server.

On a database that already holds many hundreds of thousands of cases, the first start after an upgrade may take a few minutes while new indexes are built; the site keeps working during that time.

## 6. Daily Operation Checklist

- `pm2 status` shows `online`; `/health` returns `db: true`.
- Atlas → Cloud Backup shows a recent snapshot. Test a restore once before go-live.
- `pm2 logs` has no repeating errors (look for `WARNING`, `error`, `Unhandled`).
- Disk space: `df -h` (logs and Nginx).

## 7. Capacity Check Before Go-Live

Create a staging copy of the database, load a realistic number of cases (for example 300,000 with about 20,000 open), then use k6 / Artillery to simulate the expected number of simultaneous users:

- Logging in.
- Loading their cases (`GET /api/cases`).
- Saving approvals (`PATCH /api/cases/:id`).
- Registering cases (`POST /api/cases`).

Watch:

- API response times.
- Atlas CPU and the Performance Advisor.
- `pm2 monit`.

Scale the Atlas tier up before the Node server (MongoDB does the heavy work).

## 8. Before Handing Over to the Client

- [ ] Atlas password changed; `.env` exists only on the server.
- [ ] `ADMIN_PASSWORD` is strong; the administrator changed it after the first login.
- [ ] Staff imported from the client's Excel (Coordinators, Auditors, Field Officers) and the temporary-password CSV handed over securely.
- [ ] One full test case: Intake → Field Officer → Auditor → Coordinator approval → status "Approved".
- [ ] Backup restore tested, HTTPS certificate valid, domain resolves.

## 9. Road Distances for Field Officer Selection

The Intake Desk selects field officers by road distance. Choose a provider with `MAPS_PROVIDER` in `.env`:

### A. Free (Default): OpenStreetMap

Nothing to buy and nothing to register.

Set `MAPS_CONTACT` to a real e-mail address (the public servers ask applications to identify themselves).

The server asks Nominatim for each PIN's location once (at most 1 request per second, as its policy requires), asks OSRM for the driving distance, and remembers everything in the database.

After a roster import, the officers' base PINs are looked up in the background (about 1 second each, so 200 officers take a few minutes; the first cases may show "estimate" for officers whose PIN is not looked up yet).

- The public OSRM / Nominatim servers are best effort.
- If the client expects very high volume, run your own (free software, but OSRM for India needs a large server) or use a free-tier hosted service with the same API and set `OSRM_URL`, `GEOCODER_URL`, `GEOCODER_KEY`.
- OpenStreetMap routes can differ a little from Google Maps because the map data and the PIN point differ.

### B. Google Maps (Paid)

Closest to what people see in the Google Maps app.

1. Google Cloud Console → enable billing → enable **Routes API** → create an **API key**, restricted to the Routes API and to this server's IP.
2. `.env`: `MAPS_PROVIDER=google` and `GOOGLE_MAPS_API_KEY=...`, then `pm2 restart caseallocation`.
3. Google bills per origin-destination pair with a monthly free allowance and a separate India price list; check Google's pricing page. The server asks each pair once, asks for at most about 25 officers per destination, and stops at `MAPS_DAILY_ELEMENT_BUDGET` pairs per day (default 20000). Add a billing alert in Google Cloud too.

**Check:** Run a physical case as a coordinator; distances carry a green *OpenStreetMap* or *Google Maps* label. *Estimate* / *straight-line approx.* means no road distance was available (service down, key missing, PIN not found, or budget used).
