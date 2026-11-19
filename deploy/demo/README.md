# Hosting the demo

How the public demo at odeda.run is run. It is a read-only copy of Odeda (`GA_DEMO=1`) holding
only synthetic data, behind Cloudflare. Nothing here is needed to use Odeda yourself.

```
visitor -> Cloudflare (odeda.run) -> this machine, IPv6, port 443 (nginx) -> odeda-demo
```

1. **Image.** Build it from the repository root: `docker build -t odeda:demo .`
2. **Volume.** `docker volume create odeda-demo-data`, then seed it once:
   `docker run --rm -e TZ=Asia/Qatar -e GA_DATA_DIR=/data -e GA_DB=/data/garmin.db -e GA_RAW_DIR=/data/raw_archive -e GA_TOKEN_DIR=/data/tokens -v odeda-demo-data:/data odeda:demo seed`.
   Load a plan with `python3 scripts/demo-plan.py apply`. A demo refuses every change, so load it
   while demo mode is off: run a one-off copy on the same volume without `GA_DEMO`
   (`docker run --rm -p 127.0.0.1:8003:8000 ... odeda:demo serve`), then
   `ODEDA_URL=http://127.0.0.1:8003 python3 scripts/demo-plan.py apply`, then stop it.
3. **Certificate.** In Cloudflare, SSL/TLS → Origin Server → Create certificate for the domain.
   Save the two files as `cert.pem` and `key.pem` in a folder outside the repository.
4. **Settings.** `cp .env.example .env` and fill in the machine's public IPv6 address (in square
   brackets) and the certificate folder. The IPv6 address is used because Cloudflare's free plan
   always connects to the origin on port 443 (rewriting the port is Enterprise-only), and on a
   machine that already serves another site on IPv4 port 443, IPv6 is the free address for it.
5. **Start.** `docker compose up -d`.
6. **Cloudflare.** A proxied `AAAA` record for the domain pointing at that IPv6 address, and
   SSL/TLS mode "Full (strict)". Do not add an `A` record unless something else answers on the
   IPv4 address for this name.

The edge refuses any request not addressed to the demo's own name, caps uploads at 64 KB and
limits each visitor to ten requests a second. The demo itself refuses every change.
